import { NextResponse } from 'next/server';
import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { err } from '@/lib/result';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { planAssistantTasks } from '@/ai/flows/assistant-planner';
import { generateClubAnnouncement } from '@/ai/flows/generate-announcement';
import { generateClubForm } from '@/ai/flows/generate-form';
import { resolveFollowUpAnswers } from '@/ai/flows/resolve-followups';
import { runAssistant } from '@/ai/flows/assistant';
import { generateMessage } from '@/ai/flows/generate-message';
import { generateGalleryDescription } from '@/ai/flows/generate-gallery-description';
import { addCalendarEvent } from '@/ai/flows/add-calendar-event';
import { generateEmail } from '@/ai/flows/generate-email';
import { addTransaction } from '@/ai/flows/add-transaction';
import { generateSocialMediaPost } from '@/ai/flows/generate-social-media-post';
import { generateMeetingSlides } from '@/ai/flows/generate-meeting-slides';
import { resolveAnnouncementRecipients } from '@/ai/flows/resolve-announcement-recipients';
import { resolveInsightRequest } from '@/ai/flows/resolve-insight-request';
import { resolveMetricValue } from '@/ai/flows/resolve-metric-value';
import { resolveGraphRequest } from '@/ai/flows/resolve-graph-request';
import { resolveMissedActivity } from '@/ai/flows/resolve-missed-activity';
import crypto from 'crypto';
import { getRequestDayKey } from '@/lib/day-key';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import type { Result } from '@/lib/result';

const hashPayload = (value: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(value ?? {})).digest('hex');

const buildAssistantContent = (query: string, context?: string | null) => {
  const trimmedContext =
    context && context.length > 3000 ? context.slice(-3000) : context;
  return trimmedContext
    ? `App context:\n${trimmedContext}\n\nUser: ${query}`
    : query;
};

const schema = z.object({
  orgId: z.string().uuid().optional(),
  feature: z.enum(['chat', 'insights', 'whats_new']),
  action: z.string().optional(),
  payload: z.unknown().optional(),
});

const isResultShape = <T,>(value: unknown): value is Result<T> => {
  if (!value || typeof value !== 'object') return false;
  const resultLike = value as { ok?: unknown };
  return typeof resultLike.ok === 'boolean';
};

export async function POST(request: Request) {
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown';
  const ipLimiter = rateLimit(`ai-consume:ip:${ip}`, 80, 60_000);
  if (!ipLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many AI requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(ipLimiter) }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: 'Invalid AI request.',
        source: 'app',
      }),
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const orgId = parsed.data.orgId || cookieStore.get('selectedOrgId')?.value;
  if (!orgId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Missing organization.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`ai-consume:user:${userId}`, 50, 60_000);
  if (!userLimiter.allowed) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many AI requests. Please slow down.',
        source: 'network',
      }),
      { status: 429, headers: getRateLimitHeaders(userLimiter) }
    );
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Not a member.', source: 'app' }),
      { status: 403 }
    );
  }

  const admin = createSupabaseAdmin();
  const [{ data: plan }, { data: sub }] = await Promise.all([
    admin
      .from('org_billing_plans')
      .select('daily_credit_per_user')
      .eq('org_id', orgId)
      .maybeSingle(),
    admin
      .from('org_subscriptions')
      .select('status')
      .eq('org_id', orgId)
      .maybeSingle(),
  ]);

  const status = sub?.status ?? 'inactive';
  if (!['active', 'trialing'].includes(status)) {
    return NextResponse.json(
      err({
        code: 'BILLING_INACTIVE',
        message: 'Billing inactive. In-app purchase access is not active for this organization.',
        source: 'app',
      }),
      { status: 402 }
    );
  }

  const dailyLimit = plan?.daily_credit_per_user ?? 0;
  const usageDate = getRequestDayKey(request);
  const { data: currentUsage } = await admin
    .from('org_usage_daily')
    .select('credits_used')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('usage_date', usageDate)
    .maybeSingle();
  const usedToday = Number(currentUsage?.credits_used ?? 0);

  const consumeCredit = async () => {
    const { data: result } = await admin.rpc('increment_daily_credits', {
      p_org_id: orgId,
      p_user_id: userId,
      p_usage_date: usageDate,
      p_increment_by: 1,
      p_daily_limit: dailyLimit,
    });
    const success = Array.isArray(result) ? result[0]?.success : result?.success;
    const newValue = Array.isArray(result) ? result[0]?.new_value : result?.new_value;
    return { success: Boolean(success), newValue: Number(newValue ?? 0) };
  };

  const hasCreditRemaining = dailyLimit > usedToday;
  const quotaExceededResponse = () =>
    NextResponse.json(
      err({
        code: 'DAILY_LIMIT_REACHED',
        message: 'Daily limit reached.',
        source: 'ai',
      }),
      { status: 429 }
    );

  const feature = parsed.data.feature;
  if (feature === 'chat') {
    if (!hasCreditRemaining) {
      console.info('[ai] quota exceeded', { orgId, userId });
      return quotaExceededResponse();
    }

    const action = parsed.data.action || 'assistant';
    const payload = parsed.data.payload as any;
    let response: unknown;
    try {
      switch (action) {
        case 'plan_tasks':
          response = await planAssistantTasks(payload);
          break;
        case 'followups':
          response = await resolveFollowUpAnswers(payload);
          break;
        case 'assistant':
          response = await runAssistant({
            query: buildAssistantContent(payload.query, payload.context),
          });
          break;
        case 'announcement':
          response = await generateClubAnnouncement(payload);
          break;
        case 'form':
          response = await generateClubForm(payload);
          break;
        case 'calendar':
          response = await addCalendarEvent(payload);
          break;
        case 'email':
          response = await generateEmail(payload);
          break;
        case 'messages':
          response = await generateMessage(payload);
          break;
        case 'gallery':
          response = await generateGalleryDescription(payload);
          break;
        case 'transaction':
          response = await addTransaction(payload);
          break;
        case 'social':
          response = await generateSocialMediaPost(payload);
          break;
        case 'slides':
          response = await generateMeetingSlides(payload);
          break;
        case 'announcement_recipients':
          response = await resolveAnnouncementRecipients(payload);
          break;
        case 'metric':
          response = await resolveMetricValue(payload);
          break;
        case 'graph':
          response = await resolveGraphRequest(payload);
          break;
        case 'missed_activity':
          response = await resolveMissedActivity(payload);
          break;
        default:
          return NextResponse.json(
            err({ code: 'VALIDATION', message: 'Unknown AI action.', source: 'app' }),
            { status: 400 }
          );
      }
    } catch (error) {
      console.error('[ai] chat action failed', { orgId, userId, action, error });
      return NextResponse.json(
        err({
          code: 'AI_PROVIDER_ERROR',
          message: 'AI is unavailable right now.',
          source: 'ai',
        }),
        { status: 503 }
      );
    }

    if (!isResultShape(response) || !response.ok) {
      return NextResponse.json(
        response ??
          err({
            code: 'AI_PROVIDER_ERROR',
            message: 'AI is unavailable right now.',
            source: 'ai',
          }),
        { status: 200 }
      );
    }

    const { success } = await consumeCredit();
    if (!success) {
      console.info('[ai] quota reconciliation failed after successful generation', {
        orgId,
        userId,
        action,
      });
      return NextResponse.json(response);
    }

    return NextResponse.json(response);
  }

  const payload = parsed.data.payload ?? {};
  const inputHash = hashPayload({ feature, payload });
  const { data: cached } = await admin
    .from('org_cache')
    .select('content, expires_at')
    .eq('org_id', orgId)
    .eq('cache_key', feature)
    .eq('input_hash', inputHash)
    .maybeSingle();
  if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
    console.info('[ai] cache hit', { feature, orgId });
    return NextResponse.json(cached.content);
  }

  if (!hasCreditRemaining) {
    console.info('[ai] quota exceeded', { orgId, userId, feature });
    return quotaExceededResponse();
  }

  console.info('[ai] cache miss', { feature, orgId });
  let response: unknown = null;
  try {
    if (feature === 'insights') {
      response = await resolveInsightRequest(payload as any);
    } else {
      response = await runAssistant({
        query: buildAssistantContent((payload as any)?.prompt ?? '', (payload as any)?.context),
      });
    }
  } catch (error) {
    console.error('[ai] cached feature generation failed', { orgId, userId, feature, error });
    return NextResponse.json(
      err({
        code: 'AI_PROVIDER_ERROR',
        message: 'AI is unavailable right now.',
        source: 'ai',
      }),
      { status: 503 }
    );
  }

  if (!isResultShape(response) || !response.ok) {
    return NextResponse.json(
      response ??
        err({
          code: 'AI_PROVIDER_ERROR',
          message: 'AI is unavailable right now.',
          source: 'ai',
        }),
      { status: 200 }
    );
  }

  const { success } = await consumeCredit();
  if (!success) {
    console.info('[ai] quota reconciliation failed after successful generation', {
      orgId,
      userId,
      feature,
    });
    return NextResponse.json(response);
  }

  await admin.from('org_cache').upsert({
    org_id: orgId,
    cache_key: feature,
    input_hash: inputHash,
    content: response as any,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  return NextResponse.json(response);
}
