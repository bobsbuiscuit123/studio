import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { runWithAiAction } from '@/ai/ai-action-context';
import { getRequestDayKey } from '@/lib/day-key';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import {
  aiChatRequestSchema,
  type AiChatFailureStage,
} from '@/lib/ai-chat';
import { handleAssistantTurn } from '@/lib/assistant/agent/handle-turn';
import {
  buildAssistantStorageUnavailableTurn,
  ensureAssistantStorageReady,
} from '@/lib/assistant/agent/storage';
import { parseOptionalPositiveInt, getEffectiveOrgAiAllowance } from '@/lib/org-settings';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const confirmationPhrases = new Set(['post it', 'send it', 'create it', 'confirm']);

const errorResponse = (
  message: string,
  status: number,
  options?: {
    code?: string;
    stage?: AiChatFailureStage;
    requestId?: string;
    detail?: string;
  }
) => {
  const payload: Record<string, string> = { message };
  if (options?.code) payload.code = options.code;
  if (options?.stage) payload.stage = options.stage;
  if (options?.requestId) payload.requestId = options.requestId;
  if (options?.detail) payload.detail = options.detail;
  return NextResponse.json(payload, { status });
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
    message: error instanceof Error ? error.message : String(error),
    ...(meta ?? {}),
  });
};

const requiresAiToken = (message: unknown) => {
  if (typeof message === 'string') {
    return !confirmationPhrases.has(message.trim().toLowerCase());
  }

  if (!message || typeof message !== 'object' || !('kind' in message)) {
    return true;
  }

  const kind = String((message as { kind?: unknown }).kind ?? '');
  return kind === 'message' || kind === 'regenerate';
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

      const storageReadiness = await ensureAssistantStorageReady();
      if (!storageReadiness.ok) {
        if (storageReadiness.missing) {
          console.error('[ai-chat] assistant storage unavailable', {
            requestId,
            userId: user.id,
            orgId,
            groupId,
            table: storageReadiness.table,
            message: storageReadiness.error.message,
          });

          return NextResponse.json(
            buildAssistantStorageUnavailableTurn({
              conversationId: parsed.data.conversationId || crypto.randomUUID(),
              turnId: crypto.randomUUID(),
            })
          );
        }

        logRouteFailure(requestId, stage, storageReadiness.error, {
          table: storageReadiness.table,
        });
        return errorResponse('Assistant unavailable right now.', 500, {
          stage,
          requestId,
          detail: storageReadiness.error.message,
        });
      }

      if (requiresAiToken(parsed.data.message)) {
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
        const { data: consumeData, error: consumeError } = await admin.rpc(
          'consume_org_subscription_token',
          {
            p_org_id: orgId,
            p_user_id: user.id,
            p_usage_date: usageDate,
          }
        );

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
      }

      const result = await handleAssistantTurn({
        userId: user.id,
        userEmail: user.email ?? undefined,
        orgId,
        groupId,
        message: parsed.data.message,
        conversationId: parsed.data.conversationId,
        history: parsed.data.history,
        requestId,
      });

      console.info('[ai-chat] request completed', {
        requestId,
        userId: user.id,
        orgId,
        groupId,
        conversationId: result.conversationId,
        turnId: result.turnId,
        state: result.state,
      });

      return NextResponse.json(result);
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
