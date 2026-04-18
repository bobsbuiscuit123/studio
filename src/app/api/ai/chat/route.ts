import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { callAI } from '@/ai/genkit';
import { getRequestDayKey } from '@/lib/day-key';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { AI_CHAT_ENTITIES, aiChatPlannerResultSchema, aiChatRequestSchema, type AiChatEntity, type AiChatResponse } from '@/lib/ai-chat';
import {
  AI_CHAT_PLANNER_SYSTEM_PROMPT,
  AI_CHAT_RESPONDER_SYSTEM_PROMPT,
  buildAiChatPlannerPrompt,
  buildAiChatResponderPrompt,
  fetchAiChatDataContext,
} from '@/lib/ai-chat-server';
import { getEffectiveOrgAiAllowance, parseOptionalPositiveInt } from '@/lib/org-settings';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const errorResponse = (message: string, status: number, code?: string) =>
  NextResponse.json(
    code ? { message, code } : { message },
    { status }
  );

const aiErrorStatus = (code?: string) => {
  switch (code) {
    case 'AI_TIMEOUT':
      return 504;
    case 'AI_DISABLED':
    case 'AI_QUOTA':
      return 503;
    case 'AI_BAD_RESPONSE':
    case 'AI_SCHEMA_INVALID':
      return 502;
    default:
      return 500;
  }
};

const normalizePlannerEntities = (entities: AiChatEntity[]) =>
  AI_CHAT_ENTITIES.filter(entity => entities.includes(entity));

export async function POST(request: Request) {
  try {
    const ipLimiter = rateLimit(`ai-chat-ip:${getRequestIp(request.headers)}`, 20, 60_000);
    if (!ipLimiter.allowed) {
      return rateLimitExceededResponse(ipLimiter, 'Too many AI chat requests. Please slow down.');
    }

    const body = await request.json().catch(() => ({}));
    const parsed = aiChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid AI chat request.', 400, 'VALIDATION');
    }

    const cookieStore = await cookies();
    const orgId = cookieStore.get('selectedOrgId')?.value?.trim();
    const groupId = cookieStore.get('selectedGroupId')?.value?.trim();

    if (!orgId || !groupId) {
      return errorResponse('Missing organization or group context.', 400, 'VALIDATION');
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return errorResponse('Unauthorized.', 401, 'VALIDATION');
    }

    const userLimiter = rateLimit(`ai-chat-user:${user.id}`, 30, 60_000);
    if (!userLimiter.allowed) {
      return rateLimitExceededResponse(userLimiter, 'Too many AI chat requests. Please slow down.');
    }

    const admin = createSupabaseAdmin();
    const { data: membership, error: membershipError } = await admin
      .from('group_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError) {
      return errorResponse(membershipError.message, 500);
    }
    if (!membership) {
      return errorResponse('Access denied.', 403, 'VALIDATION');
    }

    const refreshResponse = await admin.rpc('refresh_org_subscription_period', {
      p_org_id: orgId,
    });
    if (refreshResponse.error) {
      return errorResponse(refreshResponse.error.message, 500);
    }

    const { data: orgRow, error: orgError } = await admin
      .from('orgs')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();

    if (orgError) {
      return errorResponse(orgError.message, 500);
    }
    if (!orgRow) {
      return errorResponse('Organization not found.', 404);
    }

    const aiTokenLimitOverride = parseOptionalPositiveInt(
      (orgRow as Record<string, unknown>).ai_token_limit_override
    );
    if (aiTokenLimitOverride) {
      const effectiveAllowance = getEffectiveOrgAiAllowance({
        monthlyTokenLimit: Number(orgRow.monthly_token_limit ?? 0),
        bonusTokensThisPeriod: Number(orgRow.bonus_tokens_this_period ?? 0),
        aiTokenLimitOverride,
      });
      const usedThisPeriod = Number(orgRow.tokens_used_this_period ?? 0);
      if (usedThisPeriod >= effectiveAllowance) {
        return errorResponse('AI is unavailable for this organization right now.', 402, 'AI_QUOTA');
      }
    }

    const usageDate = getRequestDayKey(request);
    const { data: consumeData, error: consumeError } = await admin.rpc('consume_org_subscription_token', {
      p_org_id: orgId,
      p_user_id: user.id,
      p_usage_date: usageDate,
    });

    if (consumeError) {
      return errorResponse(consumeError.message, 500);
    }

    const consumeResult = Array.isArray(consumeData) ? consumeData[0] : consumeData;
    const reason = String(consumeResult?.reason ?? '');
    if (!consumeResult?.success) {
      if (reason === 'not_member') {
        return errorResponse('Access denied.', 403, 'VALIDATION');
      }
      if (reason === 'org_not_found') {
        return errorResponse('Organization not found.', 404);
      }
      return errorResponse('AI is unavailable for this organization right now.', 402, 'AI_QUOTA');
    }

    const plannerPrompt = buildAiChatPlannerPrompt({
      message: parsed.data.message,
      history: parsed.data.history,
      userId: user.id,
      orgId,
      groupId,
    });

    const plannerResult = await callAI({
      messages: [
        { role: 'system', content: AI_CHAT_PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: plannerPrompt },
      ],
      outputSchema: aiChatPlannerResultSchema,
      temperature: 0.1,
      timeoutMs: 15_000,
    });

    if (!plannerResult.ok) {
      return errorResponse(plannerResult.error.message, aiErrorStatus(plannerResult.error.code), plannerResult.error.code);
    }

    const planner = {
      ...plannerResult.data,
      entities: normalizePlannerEntities(plannerResult.data.entities),
    };

    const { context, usedEntities } = planner.needs_data
      ? await fetchAiChatDataContext({
          admin,
          groupId,
          entities: planner.entities,
        })
      : { context: {}, usedEntities: [] as AiChatEntity[] };

    const responderPrompt = buildAiChatResponderPrompt({
      message: parsed.data.message,
      history: parsed.data.history,
      planner,
      usedEntities,
      context,
    });

    const responderResult = await callAI({
      messages: [
        { role: 'system', content: AI_CHAT_RESPONDER_SYSTEM_PROMPT },
        { role: 'user', content: responderPrompt },
      ],
      temperature: 0.3,
      timeoutMs: 18_000,
      maxOutputChars: 2_400,
    });

    if (!responderResult.ok) {
      return errorResponse(responderResult.error.message, aiErrorStatus(responderResult.error.code), responderResult.error.code);
    }

    const response: AiChatResponse = {
      reply: responderResult.data,
      planner,
      usedEntities,
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'AI chat request failed.',
      500
    );
  }
}
