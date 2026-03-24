import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumnError } from '@/lib/org-balance';

type ConsumeOrgTokenResult = {
  success: boolean;
  reason: string;
  used_today: number;
  remaining_today: number;
  remaining_tokens: number;
};

type OrgRow = {
  ownerId: string | null;
  dailyLimit: number;
  currentBalance: number;
  balanceColumn: 'token_balance' | 'credit_balance';
};

const MAX_RETRIES = 3;

async function loadOrgRow(admin: SupabaseClient, orgId: string): Promise<OrgRow | null> {
  const modern = await admin
    .from('orgs')
    .select('owner_id, daily_ai_limit, token_balance')
    .eq('id', orgId)
    .maybeSingle();

  if (!modern.error) {
    return modern.data
      ? {
          ownerId: modern.data.owner_id ?? null,
          dailyLimit: Number(modern.data.daily_ai_limit ?? 0),
          currentBalance: Number(modern.data.token_balance ?? 0),
          balanceColumn: 'token_balance',
        }
      : null;
  }

  if (
    !isMissingColumnError(modern.error, 'owner_id') &&
    !isMissingColumnError(modern.error, 'daily_ai_limit') &&
    !isMissingColumnError(modern.error, 'token_balance')
  ) {
    throw modern.error;
  }

  const legacy = await admin
    .from('orgs')
    .select('owner_user_id, ai_daily_limit_per_user, credit_balance')
    .eq('id', orgId)
    .maybeSingle();

  if (legacy.error) {
    throw legacy.error;
  }

  return legacy.data
    ? {
        ownerId: legacy.data.owner_user_id ?? null,
        dailyLimit: Number(legacy.data.ai_daily_limit_per_user ?? 0),
        currentBalance: Number(legacy.data.credit_balance ?? 0),
        balanceColumn: 'credit_balance',
      }
    : null;
}

async function upsertDailyUsage(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  usageDate: string,
  dailyLimit: number
) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const existing = await admin
      .from('org_usage_daily')
      .select('request_count')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
      .maybeSingle();

    if (existing.error) {
      throw existing.error;
    }

    const currentRequests = Number(existing.data?.request_count ?? 0);
    if (currentRequests >= dailyLimit) {
      return {
        ok: false as const,
        reason: 'daily_limit_reached',
        usedToday: currentRequests,
      };
    }

    if (!existing.data) {
      const inserted = await admin
        .from('org_usage_daily')
        .insert({
          org_id: orgId,
          user_id: userId,
          usage_date: usageDate,
          request_count: 1,
        });

      if (!inserted.error) {
        return { ok: true as const, usedToday: 1 };
      }
    } else {
      const updated = await admin
        .from('org_usage_daily')
        .update({
          request_count: currentRequests + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .eq('usage_date', usageDate)
        .eq('request_count', currentRequests);

      if (!updated.error) {
        return { ok: true as const, usedToday: currentRequests + 1 };
      }
    }
  }

  throw new Error('Failed to update org daily AI usage.');
}

async function decrementBalance(
  admin: SupabaseClient,
  orgId: string,
  balanceColumn: 'token_balance' | 'credit_balance'
) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const org = await loadOrgRow(admin, orgId);
    if (!org || !org.ownerId) {
      return { ok: false as const, reason: 'org_not_found', remainingTokens: 0, ownerId: null };
    }

    if (org.currentBalance <= 0) {
      return {
        ok: false as const,
        reason: 'insufficient_tokens',
        remainingTokens: 0,
        ownerId: org.ownerId,
      };
    }

    const updated = await admin
      .from('orgs')
      .update({
        [balanceColumn]: org.currentBalance - 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orgId)
      .eq(balanceColumn, org.currentBalance)
      .select(balanceColumn)
      .maybeSingle();

    if (!updated.error && updated.data) {
      return {
        ok: true as const,
        remainingTokens: Number(updated.data[balanceColumn] ?? 0),
        ownerId: org.ownerId,
      };
    }
  }

  throw new Error('Failed to decrement organization token balance.');
}

export async function consumeOrgTokenCompat({
  admin,
  orgId,
  userId,
  usageDate,
}: {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  usageDate: string;
}): Promise<ConsumeOrgTokenResult> {
  const member = await admin
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (member.error) {
    throw member.error;
  }

  if (!member.data) {
    return { success: false, reason: 'not_member', used_today: 0, remaining_today: 0, remaining_tokens: 0 };
  }

  const org = await loadOrgRow(admin, orgId);
  if (!org || !org.ownerId) {
    return { success: false, reason: 'org_not_found', used_today: 0, remaining_today: 0, remaining_tokens: 0 };
  }

  if (org.currentBalance <= 0) {
    const usage = await admin
      .from('org_usage_daily')
      .select('request_count')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('usage_date', usageDate)
      .maybeSingle();
    if (usage.error) throw usage.error;
    const usedToday = Number(usage.data?.request_count ?? 0);
    return {
      success: false,
      reason: 'insufficient_tokens',
      used_today: usedToday,
      remaining_today: Math.max(org.dailyLimit - usedToday, 0),
      remaining_tokens: 0,
    };
  }

  if (org.dailyLimit <= 0) {
    return {
      success: false,
      reason: 'daily_limit_reached',
      used_today: 0,
      remaining_today: 0,
      remaining_tokens: org.currentBalance,
    };
  }

  const usageResult = await upsertDailyUsage(admin, orgId, userId, usageDate, org.dailyLimit);
  if (!usageResult.ok) {
    return {
      success: false,
      reason: usageResult.reason,
      used_today: usageResult.usedToday,
      remaining_today: Math.max(org.dailyLimit - usageResult.usedToday, 0),
      remaining_tokens: org.currentBalance,
    };
  }

  const balanceResult = await decrementBalance(admin, orgId, org.balanceColumn);
  if (!balanceResult.ok) {
    return {
      success: false,
      reason: balanceResult.reason,
      used_today: usageResult.usedToday,
      remaining_today: Math.max(org.dailyLimit - usageResult.usedToday, 0),
      remaining_tokens: balanceResult.remainingTokens,
    };
  }

  const aiUsageInsert = await admin.from('ai_usage_logs').insert({
    organization_id: orgId,
    user_id: userId,
    owner_user_id: balanceResult.ownerId,
    request_count: 1,
    tokens_charged: 1,
  });
  if (aiUsageInsert.error) {
    console.error('AI usage log insert failed', aiUsageInsert.error);
  }

  const tokenTxInsert = await admin.from('token_transactions').insert({
    user_id: balanceResult.ownerId,
    organization_id: orgId,
    actor_user_id: userId,
    type: 'usage',
    amount: -1,
    balance_after: balanceResult.remainingTokens,
    description: 'AI request token charge',
    metadata: { usage_date: usageDate, request_count: 1 },
  });
  if (tokenTxInsert.error) {
    console.error('Token usage transaction insert failed', tokenTxInsert.error);
  }

  return {
    success: true,
    reason: 'ok',
    used_today: usageResult.usedToday,
    remaining_today: Math.max(org.dailyLimit - usageResult.usedToday, 0),
    remaining_tokens: balanceResult.remainingTokens,
  };
}
