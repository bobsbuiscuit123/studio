import type { SupabaseClient } from '@supabase/supabase-js';
import { readBalance, isMissingColumnError, isMissingFunctionError } from '@/lib/org-balance';
import { normalizeTokenProductId } from '@/lib/pricing';

type TokenGrantResult = {
  granted: boolean;
  tokenBalance: number;
  tokensGranted: number;
};

const PRODUCT_TOKEN_MAP: Record<string, number> = {
  tokens_basic: 2200,
  tokens_growth: 6000,
  tokens_pro: 12500,
  tokens_scale: 28000,
  tokens_enterprise: 65000,
};

const getMappedTokens = (productId: string) => PRODUCT_TOKEN_MAP[normalizeTokenProductId(productId)] ?? 0;

async function loadOrgBalanceRow(admin: SupabaseClient, orgId: string) {
  const modern = await admin
    .from('orgs')
    .select('id, owner_id, token_balance')
    .eq('id', orgId)
    .maybeSingle();

  if (!modern.error) {
    return {
      row: modern.data
        ? {
            id: modern.data.id,
            ownerId: modern.data.owner_id,
            balance: Number(modern.data.token_balance ?? 0),
            balanceColumn: 'token_balance' as const,
          }
        : null,
      error: null,
    };
  }

  if (
    !isMissingColumnError(modern.error, 'owner_id') &&
    !isMissingColumnError(modern.error, 'token_balance')
  ) {
    return { row: null, error: modern.error };
  }

  const legacy = await admin
    .from('orgs')
    .select('id, owner_user_id, credit_balance')
    .eq('id', orgId)
    .maybeSingle();

  if (legacy.error) {
    return { row: null, error: legacy.error };
  }

  return {
    row: legacy.data
      ? {
          id: legacy.data.id,
          ownerId: legacy.data.owner_user_id,
          balance: Number(legacy.data.credit_balance ?? 0),
          balanceColumn: 'credit_balance' as const,
        }
      : null,
    error: null,
  };
}

async function updateOrgBalance(
  admin: SupabaseClient,
  orgId: string,
  balanceColumn: 'token_balance' | 'credit_balance',
  nextBalance: number
) {
  const withTimestamp = await admin
    .from('orgs')
    .update({
      [balanceColumn]: nextBalance,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId);

  if (!withTimestamp.error) {
    return withTimestamp;
  }

  if (!isMissingColumnError(withTimestamp.error, 'updated_at')) {
    return withTimestamp;
  }

  return admin
    .from('orgs')
    .update({
      [balanceColumn]: nextBalance,
    })
    .eq('id', orgId);
}

type GrantTokenPurchaseParams = {
  admin: SupabaseClient;
  userId: string;
  orgId: string;
  productId: string;
  transactionId: string;
  provider: string;
  environment?: string | null;
  metadata?: Record<string, unknown>;
};

export async function grantTokenPurchaseCompat({
  admin,
  userId,
  orgId,
  productId,
  transactionId,
  provider,
  environment = null,
  metadata = {},
}: GrantTokenPurchaseParams): Promise<TokenGrantResult> {
  const normalizedProductId = normalizeTokenProductId(productId);
  const rpc = await admin.rpc('grant_token_purchase', {
    p_user_id: userId,
    p_product_id: normalizedProductId || productId,
    p_provider_transaction_id: transactionId,
    p_provider: provider,
    p_environment: environment,
    p_metadata: metadata,
    p_org_id: orgId,
  });

  if (!rpc.error) {
    const result = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    return {
      granted: Boolean(result?.granted),
      tokenBalance: Number(result?.token_balance ?? 0),
      tokensGranted: Number(result?.tokens_granted ?? 0),
    };
  }

  if (
    !isMissingColumnError(rpc.error, 'token_balance') &&
    !isMissingColumnError(rpc.error, 'owner_id') &&
    !isMissingFunctionError(rpc.error, 'grant_token_purchase')
  ) {
    throw rpc.error;
  }

  const tokensGranted = getMappedTokens(normalizedProductId || productId);
  if (tokensGranted <= 0) {
    throw new Error(`Unknown token product id: ${productId}`);
  }

  const existingGrant = await admin
    .from('token_purchase_grants')
    .select('tokens_granted, org_id')
    .eq('provider', provider)
    .eq('provider_transaction_id', transactionId)
    .maybeSingle();

  if (existingGrant.data) {
    const existingOrg = await loadOrgBalanceRow(admin, existingGrant.data.org_id);
    if (existingOrg.error) throw existingOrg.error;
    return {
      granted: false,
      tokenBalance: existingOrg.row?.balance ?? 0,
      tokensGranted: Number(existingGrant.data.tokens_granted ?? 0),
    };
  }
  if (existingGrant.error && !isMissingColumnError(existingGrant.error, 'tokens_granted')) {
    throw existingGrant.error;
  }

  const orgResult = await loadOrgBalanceRow(admin, orgId);
  if (orgResult.error) throw orgResult.error;
  if (!orgResult.row?.ownerId) {
    throw new Error('Organization not found for this purchase.');
  }
  if (orgResult.row.ownerId !== userId) {
    throw new Error('Only the organization owner can receive token purchases.');
  }

  const grantInsert = await admin.from('token_purchase_grants').insert({
    user_id: userId,
    provider,
    provider_transaction_id: transactionId,
    org_id: orgId,
    product_id: normalizedProductId || productId,
    tokens_granted: tokensGranted,
    environment,
    metadata,
  });

  if (grantInsert.error) {
    if (String((grantInsert.error as { code?: string }).code ?? '') === '23505') {
      const latestOrg = await loadOrgBalanceRow(admin, orgId);
      if (latestOrg.error) throw latestOrg.error;
      return {
        granted: false,
        tokenBalance: latestOrg.row?.balance ?? 0,
        tokensGranted,
      };
    }
    throw grantInsert.error;
  }

  const nextBalance = orgResult.row.balance + tokensGranted;
  const balanceUpdate = await updateOrgBalance(
    admin,
    orgId,
    orgResult.row.balanceColumn,
    nextBalance
  );

  if (balanceUpdate.error) {
    await admin
      .from('token_purchase_grants')
      .delete()
      .eq('provider', provider)
      .eq('provider_transaction_id', transactionId);
    throw balanceUpdate.error;
  }

  const transactionInsert = await admin.from('token_transactions').insert({
    user_id: userId,
    organization_id: orgId,
    actor_user_id: userId,
    type: 'purchase',
    amount: tokensGranted,
    balance_after: nextBalance,
    description: 'Apple token purchase',
    metadata: {
      ...metadata,
      provider,
      provider_transaction_id: transactionId,
      product_id: normalizedProductId || productId,
      environment,
      organization_id: orgId,
    },
  });

  if (transactionInsert.error) {
    console.error('Token transaction activity insert failed', transactionInsert.error);
  }

  return {
    granted: true,
    tokenBalance: nextBalance,
    tokensGranted,
  };
}
