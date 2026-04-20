import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { runWithAiAction } from '@/ai/ai-action-context';
import { activeModelName, activeProvider, callAI } from '@/ai/genkit';
import { getRequestDayKey } from '@/lib/day-key';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import {
  AI_CHAT_ENTITIES,
  aiChatPlannerResultSchema,
  aiChatRequestSchema,
  type AiChatEntity,
  type AiChatFailureStage,
  type AiChatResponse,
} from '@/lib/ai-chat';
import {
  AI_CHAT_PLANNER_SYSTEM_PROMPT,
  AI_CHAT_RESPONDER_SYSTEM_PROMPT,
  buildAiChatPlannerPrompt,
  buildAiChatResponderPrompt,
  filterAllowedAiChatEntities,
  fetchAiChatDataContext,
  getAllowedAiChatEntities,
} from '@/lib/ai-chat-server';
import { displayGroupRole, normalizeGroupRole } from '@/lib/group-permissions';
import { getEffectiveOrgAiAllowance, parseOptionalPositiveInt } from '@/lib/org-settings';
import { rateLimit } from '@/lib/rate-limit';
import type { Result } from '@/lib/result';

export const dynamic = 'force-dynamic';

const sanitizePublicAiDetail = (detail?: string) => {
  if (!detail) return undefined;

  const flattened = detail.replace(/\s+/g, ' ').trim();
  if (!flattened) return undefined;

  return flattened.length > 280 ? `${flattened.slice(0, 279)}…` : flattened;
};

const errorResponse = (
  message: string,
  status: number,
  options?: {
    code?: string;
    stage?: AiChatFailureStage;
    requestId?: string;
    detail?: string;
    publicDetail?: string;
  }
) => {
  const payload: Record<string, string> = { message };
  if (options?.code) payload.code = options.code;
  if (options?.stage) payload.stage = options.stage;
  if (options?.requestId) payload.requestId = options.requestId;
  if (options?.publicDetail) {
    payload.detail = options.publicDetail;
  }

  return NextResponse.json(payload, { status });
};

const aiErrorStatus = (code?: string) => {
  switch (code) {
    case 'AI_SAFETY_LIMIT':
      return 429;
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

type AiStepAttempt = 'primary' | 'fallback';
type AiStepRunResult<TValue> = {
  result: Result<TValue>;
  attempt: AiStepAttempt;
};

const shouldRetryAiFailure = (result: Result<unknown>) =>
  !result.ok &&
  result.error.retryable &&
  (
    result.error.code === 'AI_PROVIDER_ERROR' ||
    result.error.code === 'AI_TIMEOUT' ||
    result.error.code === 'AI_BAD_RESPONSE' ||
    result.error.code === 'AI_SCHEMA_INVALID'
  );

const logAiStepFailure = (
  requestId: string,
  step: 'planner' | 'responder',
  attempt: AiStepAttempt,
  result: Result<unknown>
) => {
  if (result.ok) return;

  console.error(`[ai-chat] ${step} ${attempt} failed`, {
    requestId,
    provider: activeProvider,
    model: activeModelName,
    code: result.error.code,
    message: result.error.message,
    detail: result.error.detail,
    retryable: result.error.retryable,
  });
};

const logRouteFailure = (
  requestId: string,
  stage: AiChatFailureStage,
  error: unknown,
  meta?: Record<string, unknown>
) => {
  console.error('[ai-chat] route failed', {
    requestId,
    stage,
    provider: activeProvider,
    model: activeModelName,
    message: error instanceof Error ? error.message : String(error),
    ...(meta ?? {}),
  });
};

const buildPublicAiFailureDetail = ({
  attempt,
  code,
  detail,
}: {
  attempt: AiStepAttempt;
  code?: string;
  detail?: string;
}) => {
  const normalizedDetail = sanitizePublicAiDetail(detail);
  return [
    code ? `code=${code}` : null,
    `attempt=${attempt}`,
    normalizedDetail ?? null,
  ]
    .filter(Boolean)
    .join(' | ');
};

const runPlannerStep = async (requestId: string, plannerPrompt: string): Promise<AiStepRunResult<{
  needs_data: boolean;
  intent: 'GENERATION' | 'MEMBERSHIP' | 'GROUP_DATA';
  entities: AiChatEntity[];
}>> => {
  const primaryResult = await callAI({
    messages: [
      { role: 'system', content: AI_CHAT_PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: plannerPrompt },
    ],
    responseFormat: 'json_object',
    outputSchema: aiChatPlannerResultSchema,
    temperature: 0.1,
    timeoutMs: 20_000,
  });

  if (primaryResult.ok || !shouldRetryAiFailure(primaryResult)) {
    return { result: primaryResult, attempt: 'primary' };
  }

  logAiStepFailure(requestId, 'planner', 'primary', primaryResult);

  const fallbackResult = await callAI({
    messages: [
      {
        role: 'user',
        content: `${AI_CHAT_PLANNER_SYSTEM_PROMPT}\n\n${plannerPrompt}`,
      },
    ],
    responseFormat: 'json_object',
    outputSchema: aiChatPlannerResultSchema,
    temperature: 0.1,
    timeoutMs: 28_000,
  });

  logAiStepFailure(requestId, 'planner', 'fallback', fallbackResult);
  return { result: fallbackResult, attempt: 'fallback' };
};

const runResponderStep = async (
  requestId: string,
  responderPrompt: string
): Promise<AiStepRunResult<string>> => {
  const primaryResult = await callAI({
    messages: [
      { role: 'system', content: AI_CHAT_RESPONDER_SYSTEM_PROMPT },
      { role: 'user', content: responderPrompt },
    ],
    temperature: 0.3,
    timeoutMs: 24_000,
    maxOutputChars: 2_400,
  });

  if (primaryResult.ok || !shouldRetryAiFailure(primaryResult)) {
    return { result: primaryResult, attempt: 'primary' };
  }

  logAiStepFailure(requestId, 'responder', 'primary', primaryResult);

  const fallbackResult = await callAI({
    messages: [
      {
        role: 'user',
        content: `${AI_CHAT_RESPONDER_SYSTEM_PROMPT}\n\n${responderPrompt}`,
      },
    ],
    temperature: 0.25,
    timeoutMs: 30_000,
    maxOutputChars: 2_400,
  });

  logAiStepFailure(requestId, 'responder', 'fallback', fallbackResult);
  return { result: fallbackResult, attempt: 'fallback' };
};

export async function POST(request: Request) {
  return runWithAiAction('aiChatRoute', async () => {
    const requestId = crypto.randomUUID();
    let stage: AiChatFailureStage = 'request_validation';

    try {
      const ipLimiter = rateLimit(`ai-chat-ip:${getRequestIp(request.headers)}`, 20, 60_000);
      if (!ipLimiter.allowed) {
        return rateLimitExceededResponse(ipLimiter, 'Too many AI chat requests. Please slow down.');
      }

      const body = await request.json().catch(() => ({}));
      const parsed = aiChatRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse('Invalid AI chat request.', 400, {
          code: 'VALIDATION',
          stage,
          requestId,
        });
      }

      stage = 'context';
      const cookieStore = await cookies();
      const orgId = cookieStore.get('selectedOrgId')?.value?.trim();
      const groupId = cookieStore.get('selectedGroupId')?.value?.trim();

      if (!orgId || !groupId) {
        return errorResponse('Missing organization or group context.', 400, {
          code: 'VALIDATION',
          stage,
          requestId,
        });
      }

      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        return errorResponse('Unauthorized.', 401, {
          code: 'VALIDATION',
          stage,
          requestId,
          detail: userError?.message,
        });
      }

      const userLimiter = rateLimit(`ai-chat-user:${user.id}`, 30, 60_000);
      if (!userLimiter.allowed) {
        return rateLimitExceededResponse(userLimiter, 'Too many AI chat requests. Please slow down.');
      }

      stage = 'membership';
      const admin = createSupabaseAdmin();
      const { data: membership, error: membershipError } = await admin
        .from('group_memberships')
        .select('role')
        .eq('org_id', orgId)
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (membershipError) {
        logRouteFailure(requestId, stage, membershipError);
        return errorResponse(membershipError.message, 500, {
          stage,
          requestId,
          detail: membershipError.message,
        });
      }
      if (!membership) {
        return errorResponse('Access denied.', 403, {
          code: 'VALIDATION',
          stage,
          requestId,
        });
      }

      stage = 'quota';
      const refreshResponse = await admin.rpc('refresh_org_subscription_period', {
        p_org_id: orgId,
      });
      if (refreshResponse.error) {
        logRouteFailure(requestId, stage, refreshResponse.error);
        return errorResponse(refreshResponse.error.message, 500, {
          stage,
          requestId,
          detail: refreshResponse.error.message,
        });
      }

      const { data: orgRow, error: orgError } = await admin
        .from('orgs')
        .select('*')
        .eq('id', orgId)
        .maybeSingle();

      if (orgError) {
        logRouteFailure(requestId, stage, orgError);
        return errorResponse(orgError.message, 500, {
          stage,
          requestId,
          detail: orgError.message,
        });
      }
      if (!orgRow) {
        return errorResponse('Organization not found.', 404, {
          stage,
          requestId,
        });
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
          return errorResponse('AI is unavailable for this organization right now.', 402, {
            code: 'AI_QUOTA',
            stage,
            requestId,
          });
        }
      }

      const usageDate = getRequestDayKey(request);
      const { data: consumeData, error: consumeError } = await admin.rpc('consume_org_subscription_token', {
        p_org_id: orgId,
        p_user_id: user.id,
        p_usage_date: usageDate,
      });

      if (consumeError) {
        logRouteFailure(requestId, stage, consumeError);
        return errorResponse(consumeError.message, 500, {
          stage,
          requestId,
          detail: consumeError.message,
        });
      }

      const consumeResult = Array.isArray(consumeData) ? consumeData[0] : consumeData;
      const reason = String(consumeResult?.reason ?? '');
      if (!consumeResult?.success) {
        if (reason === 'not_member') {
          return errorResponse('Access denied.', 403, {
            code: 'VALIDATION',
            stage,
            requestId,
          });
        }
        if (reason === 'org_not_found') {
          return errorResponse('Organization not found.', 404, {
            stage,
            requestId,
          });
        }
        return errorResponse('AI is unavailable for this organization right now.', 402, {
          code: 'AI_QUOTA',
          stage,
          requestId,
          detail: reason || undefined,
        });
      }

      stage = 'planner';
      const plannerPrompt = buildAiChatPlannerPrompt({
        message: parsed.data.message,
        history: parsed.data.history,
        userId: user.id,
        userEmail: user.email ?? '',
        orgId,
        groupId,
        role: displayGroupRole(normalizeGroupRole(membership.role)),
        availableEntities: getAllowedAiChatEntities(membership.role),
      });

      const plannerRun = await runPlannerStep(requestId, plannerPrompt);
      const plannerResult = plannerRun.result;

      if (!plannerResult.ok) {
        return errorResponse(plannerResult.error.message, aiErrorStatus(plannerResult.error.code), {
          code: plannerResult.error.code,
          stage,
          requestId,
          publicDetail: buildPublicAiFailureDetail({
            attempt: plannerRun.attempt,
            code: plannerResult.error.code,
            detail: plannerResult.error.detail,
          }),
        });
      }

      const planner = {
        ...plannerResult.data,
        entities: filterAllowedAiChatEntities(
          normalizePlannerEntities(plannerResult.data.entities),
          membership.role
        ),
      };

      stage = 'group_data_fetch';
      const { context, usedEntities } = planner.needs_data
        ? await fetchAiChatDataContext({
            admin,
            groupId,
            entities: planner.entities,
            role: membership.role,
          }).catch(error => {
            logRouteFailure(requestId, stage, error, {
              planner,
              requestedEntities: planner.entities,
            });
            throw error;
          })
        : { context: {}, usedEntities: [] as AiChatEntity[] };

      stage = 'responder';
      const responderPrompt = buildAiChatResponderPrompt({
        message: parsed.data.message,
        history: parsed.data.history,
        planner,
        usedEntities,
        context,
        currentUserEmail: user.email ?? '',
      });

      const responderRun = await runResponderStep(requestId, responderPrompt);
      const responderResult = responderRun.result;

      if (!responderResult.ok) {
        return errorResponse(responderResult.error.message, aiErrorStatus(responderResult.error.code), {
          code: responderResult.error.code,
          stage,
          requestId,
          publicDetail: buildPublicAiFailureDetail({
            attempt: responderRun.attempt,
            code: responderResult.error.code,
            detail: responderResult.error.detail,
          }),
        });
      }

      const response: AiChatResponse = {
        reply: responderResult.data,
        planner,
        usedEntities,
      };

      return NextResponse.json(response);
    } catch (error) {
      logRouteFailure(requestId, stage, error);
      return errorResponse(
        error instanceof Error ? error.message : 'AI chat request failed.',
        500,
        {
          stage,
          requestId,
        }
      );
    }
  });
}
