import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { generateClubAnnouncement } from '@/ai/flows/generate-announcement';
import { generateClubForm } from '@/ai/flows/generate-form';
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
import { clampAiOutputChars, MAX_TAB_AI_OUTPUT_CHARS } from '@/lib/ai-output-limit';
import { isResult } from '@/lib/result';
import { getRequestDayKey } from '@/lib/day-key';
import { consumeOrgTokenCompat } from '@/lib/org-token-consumption';
import { isMissingColumnError, isMissingFunctionError } from '@/lib/org-balance';

const schema = z.object({
  orgId: z.string().uuid().optional(),
  feature: z.enum(['chat', 'insights', 'whats_new']),
  action: z.string().optional(),
  payload: z.unknown().optional(),
});

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

const successResponse = (result: unknown, status = 200) => {
  if (!result) {
    return new Response(
      JSON.stringify({
        error: true,
        message: 'AI returned null',
      }),
      {
        status: 500,
        headers: jsonHeaders,
      }
    );
  }

  console.log('AI RESULT:', result);
  return new Response(
    JSON.stringify({
      success: true,
      data: result,
    }),
    {
      status,
      headers: jsonHeaders,
    }
  );
};

const errorResponse = (error: unknown, status = 500) =>
  new Response(
    JSON.stringify({
      error: true,
      message:
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message || 'Unknown error')
          : 'Unknown error',
    }),
    {
      status,
      headers: jsonHeaders,
    }
  );

const clampTabAiResult = (value: unknown) => {
  if (isResult(value)) {
    if (!value.ok) {
      return value;
    }

    return {
      ...value,
      data: clampAiOutputChars(value.data, MAX_TAB_AI_OUTPUT_CHARS),
    };
  }

  return clampAiOutputChars(value, MAX_TAB_AI_OUTPUT_CHARS);
};

const cappedTabActions = new Set([
  'announcement',
  'form',
  'calendar',
  'email',
  'messages',
  'gallery',
  'transaction',
  'social',
  'slides',
]);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    console.log('REQUEST BODY:', body);

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(new Error('Invalid AI request.'), 500);
    }

    const headerList = await headers();
    const cookieStore = await cookies();
    const payload = parsed.data.payload as Record<string, unknown> | undefined;
    const orgId = parsed.data.orgId || cookieStore.get('selectedOrgId')?.value;
    const groupId =
      cookieStore.get('selectedGroupId')?.value ||
      (typeof payload?.groupId === 'string' ? payload.groupId : undefined) ||
      orgId;
    if (!orgId) {
      return errorResponse(new Error('Missing organization.'), 500);
    }
    if (!groupId) {
      console.warn('No groupId found, continuing without it');
    }

    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return errorResponse(new Error('Unauthorized.'), 500);
    }

    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    if (!ip) {
      return errorResponse(new Error('Unknown error'), 500);
    }

    const admin = createSupabaseAdmin();

    const usageDate = getRequestDayKey(request);
    const { data: consumeData, error: consumeError } = await admin.rpc('consume_owner_token_for_org_ai', {
      p_org_id: orgId,
      p_user_id: userId,
      p_usage_date: usageDate,
    });

    let consumeResult = Array.isArray(consumeData) ? consumeData[0] : consumeData;

    if (consumeError) {
      if (
        isMissingFunctionError(consumeError, 'consume_owner_token_for_org_ai') ||
        isMissingColumnError(consumeError, 'token_balance') ||
        isMissingColumnError(consumeError, 'credit_balance') ||
        isMissingColumnError(consumeError, 'owner_id')
      ) {
        consumeResult = await consumeOrgTokenCompat({
          admin,
          orgId,
          userId,
          usageDate,
        });
      } else {
        return errorResponse(new Error(consumeError.message), 500);
      }
    }

    const initialReason = String(consumeResult?.reason ?? '');

    if (!consumeResult?.success && (initialReason === 'insufficient_tokens' || initialReason === '')) {
      consumeResult = await consumeOrgTokenCompat({
        admin,
        orgId,
        userId,
        usageDate,
      });
    }

    const reason = String(consumeResult?.reason ?? '');
    const remainingTokens = Number(consumeResult?.remaining_tokens ?? 0);
    const remainingToday = Number(consumeResult?.remaining_today ?? 0);

    if (!consumeResult?.success) {
      if (reason === 'not_member') {
        return errorResponse(new Error('Not a member.'), 403);
      }

      if (reason === 'daily_limit_reached') {
        return errorResponse(new Error('Daily limit reached.'), 429);
      }

      if (reason === 'insufficient_tokens' || reason === '') {
        return errorResponse(new Error('AI temporarily unavailable. Your organization has run out of credits.'), 402);
      }

      if (reason === 'org_not_found') {
        return errorResponse(new Error('Organization not found.'), 404);
      }

      return errorResponse(new Error('AI temporarily unavailable.'), 402);
    }

    console.log('Token usage remaining tokens:', remainingTokens, 'remaining today:', remainingToday);

    const feature = parsed.data.feature;
    const action = parsed.data.action || (feature === 'chat' ? 'assistant' : feature);

    const messageSource =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.query === 'string'
          ? payload.query
          : typeof payload?.prompt === 'string'
            ? payload.prompt
            : '';
    const message = String(messageSource ?? '').trim();
    console.log('MESSAGE:', message);

    let result: unknown;

    if (feature === 'chat') {
      switch (action) {
        case 'assistant':
          if (!message) {
            return errorResponse(new Error('AI returned null'), 500);
          }
          result = await runAssistant({
            query: message,
            history: Array.isArray(payload?.history)
              ? payload.history.filter(
                  (
                    item: unknown
                  ): item is { role: 'user' | 'assistant'; content: string } =>
                    Boolean(item) &&
                    typeof item === 'object' &&
                    ((item as { role?: unknown }).role === 'user' ||
                      (item as { role?: unknown }).role === 'assistant') &&
                    typeof (item as { content?: unknown }).content === 'string'
                )
              : undefined,
            orgId,
            groupId: groupId || orgId,
            userId,
          });
          break;
        case 'announcement':
          result = await generateClubAnnouncement(payload as any);
          break;
        case 'form':
          result = await generateClubForm(payload as any);
          break;
        case 'calendar':
          result = await addCalendarEvent(payload as any);
          break;
        case 'email':
          result = await generateEmail(payload as any);
          break;
        case 'messages':
          result = await generateMessage(payload as any);
          break;
        case 'gallery':
          result = await generateGalleryDescription(payload as any);
          break;
        case 'transaction':
          result = await addTransaction(payload as any);
          break;
        case 'social':
          result = await generateSocialMediaPost(payload as any);
          break;
        case 'slides':
          result = await generateMeetingSlides(payload as any);
          break;
        case 'announcement_recipients':
          result = await resolveAnnouncementRecipients(payload as any);
          break;
        case 'metric':
          result = await resolveMetricValue(payload as any);
          break;
        case 'graph':
          result = await resolveGraphRequest(payload as any);
          break;
        case 'missed_activity':
          result = await resolveMissedActivity(payload as any);
          break;
        default:
          return errorResponse(new Error('Unknown AI action.'), 500);
      }
    } else if (feature === 'insights') {
      result = await resolveInsightRequest(payload as any);
    } else {
      if (!message) {
        return errorResponse(new Error('AI returned null'), 500);
      }
      result = await runAssistant({
        query: message,
        history: undefined,
        orgId,
        groupId: groupId || orgId,
        userId,
      });
    }

    if (!result) {
      return new Response(
        JSON.stringify({
          error: true,
          message: 'AI returned null',
        }),
        {
          status: 500,
          headers: jsonHeaders,
        }
      );
    }

    const shouldClampResult =
      feature === 'chat' && cappedTabActions.has(action);
    const finalResult = shouldClampResult ? clampTabAiResult(result) : result;

    console.log('AI RESULT:', finalResult);
    return successResponse(finalResult, 200);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: true,
        message:
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message || 'Unknown error')
            : 'Unknown error',
      }),
      {
        status: 500,
        headers: jsonHeaders,
      }
    );
  }
}
