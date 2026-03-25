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
  const buildModernRow = (data: {
    id: string;
    owner_id?: string | null;
    token_balance?: unknown;
    credit_balance?: unknown;
  }) => {
    const resolved = readBalance(data);
    return {
      id: data.id,
      ownerId: data.owner_id ?? null,
      balance: resolved.balance,
      balanceSource: resolved.source,
      tokenBalance: resolved.tokenBalance,
      creditBalance: resolved.creditBalance,
      legacyOnly: false,
    };
  };

  const modern = await admin
    .from('orgs')
    .select('id, owner_id, token_balance, credit_balance')
    .eq('id', orgId)
    .maybeSingle();

  if (!modern.error) {
    return {
      row: modern.data ? buildModernRow(modern.data) : null,
      error: null,
    };
  }

  if (isMissingColumnError(modern.error, 'credit_balance')) {
    const modernWithoutCredit = await admin
      .from('orgs')
      .select('id, owner_id, token_balance')
      .eq('id', orgId)
      .maybeSingle();

    if (!modernWithoutCredit.error) {
      return {
        row: modernWithoutCredit.data
          ? buildModernRow({
              ...modernWithoutCredit.data,
              credit_balance: null,
            })
          : null,
        error: null,
      };
    }

    if (
      !isMissingColumnError(modernWithoutCredit.error, 'owner_id') &&
      !isMissingColumnError(modernWithoutCredit.error, 'token_balance')
    ) {
      return { row: null, error: modernWithoutCredit.error };
    }
  }

  if (
    !isMissingColumnError(modern.error, 'owner_id') &&
    !isMissingColumnError(modern.error, 'token_balance') &&
    !isMissingColumnError(modern.error, 'credit_balance')
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
          balanceSource: 'credit' as const,
          tokenBalance: null,
          creditBalance: Number(legacy.data.credit_balance ?? 0),
          legacyOnly: true,
        }
      : null,
    error: null,
  };
}

async function updateOrgBalance(
  admin: SupabaseClient,
  org: NonNullable<Awaited<ReturnType<typeof loadOrgBalanceRow>>['row']>,
  nextBalance: number
) {
  const writeToTokenBalance = !org.legacyOnly && org.balanceSource === 'credit';
  const balanceColumn =
    writeToTokenBalance || org.balanceSource === 'token' ? 'token_balance' : 'credit_balance';
  const currentStoredBalance =
    balanceColumn === 'token_balance'
      ? Number(org.tokenBalance ?? 0)
      : Number(org.creditBalance ?? 0);

  const withTimestamp = await admin
    .from('orgs')
    .update({
      [balanceColumn]: nextBalance,
      updated_at: new Date().toISOString(),
    })
    .eq('id', org.id)
    .eq(balanceColumn, currentStoredBalance);

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
    .eq('id', org.id)
    .eq(balanceColumn, currentStoredBalance);
}

async function findPurchaseTransaction(
  admin: SupabaseClient,
  orgId: string,
  transactionId: string
) {
  const transactions = await admin
    .from('token_transactions')
    .select('id, metadata')
    .eq('organization_id', orgId)
    .eq('type', 'purchase')
    .order('created_at', { ascending: false })
    .limit(25);

  if (transactions.error) {
    console.error('Failed to inspect existing token purchase transactions', transactions.error);
    return null;
  }

  return (
    transactions.data?.find((row) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : null;
      return String(metadata?.provider_transaction_id ?? '').trim() === transactionId;
    }) ?? null
  );
}

async function insertPurchaseTransaction(
  admin: SupabaseClient,
  {
    userId,
    orgId,
    transactionId,
    provider,
    productId,
    environment,
    tokensGranted,
    balanceAfter,
    metadata,
  }: {
    userId: string;
    orgId: string;
    transactionId: string;
    provider: string;
    productId: string;
    environment?: string | null;
    tokensGranted: number;
    balanceAfter: number;
    metadata: Record<string, unknown>;
  }
) {
  const existingTransaction = await findPurchaseTransaction(admin, orgId, transactionId);
  if (existingTransaction) {
    return { error: null };
  }

  return admin.from('token_transactions').insert({
    user_id: userId,
    organization_id: orgId,
    actor_user_id: userId,
    type: 'purchase',
    amount: tokensGranted,
    balance_after: balanceAfter,
    description: 'Apple token purchase',
    metadata: {
      ...metadata,
      provider,
      provider_transaction_id: transactionId,
      product_id: productId,
      environment,
      organization_id: orgId,
    },
  });
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
  const readPersistedOrgBalance = async () => {
    const persistedOrg = await loadOrgBalanceRow(admin, orgId);
    if (persistedOrg.error) throw persistedOrg.error;
    if (!persistedOrg.row) {
      throw new Error('Organization not found after token purchase grant.');
    }
    return persistedOrg.row.balance;
  };

  const normalizedProductId = normalizeTokenProductId(productId);
  const initialOrg = await loadOrgBalanceRow(admin, orgId);
  if (initialOrg.error) {
    throw initialOrg.error;
  }
  const initialBalance = Number(initialOrg.row?.balance ?? 0);
  const shouldBypassRpc =
    Boolean(initialOrg.row) &&
    !initialOrg.row.legacyOnly &&
    initialOrg.row.balanceSource === 'credit' &&
    initialOrg.row.balance > 0;

  if (!shouldBypassRpc) {
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
      const persistedBalance = await readPersistedOrgBalance();
      const rpcGranted = Boolean(result?.granted);
      const rpcTokensGranted = Number(result?.tokens_granted ?? 0);
      const expectedPersistedBalance =
        rpcGranted && rpcTokensGranted > 0 ? initialBalance + rpcTokensGranted : null;

      if (
        !rpcGranted ||
        !Number.isFinite(expectedPersistedBalance) ||
        persistedBalance >= Number(expectedPersistedBalance)
      ) {
        return {
          granted: rpcGranted,
          tokenBalance: persistedBalance,
          tokensGranted: rpcTokensGranted,
        };
      }

      console.warn(
        'grant_token_purchase reported success without persisting the org balance; repairing with direct grant logic.',
        {
          orgId,
          transactionId,
          persistedBalance,
          expectedPersistedBalance,
        }
      );
    }

    if (
      !isMissingColumnError(rpc.error, 'token_balance') &&
      !isMissingColumnError(rpc.error, 'owner_id') &&
      !isMissingFunctionError(rpc.error, 'grant_token_purchase')
    ) {
      throw rpc.error;
    }
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
    const existingTokensGranted = Number(existingGrant.data.tokens_granted ?? 0);
    const existingOrg = await loadOrgBalanceRow(admin, existingGrant.data.org_id);
    if (existingOrg.error) throw existingOrg.error;
    const shouldRepairExistingGrant =
      existingGrant.data.org_id === orgId &&
      Boolean(initialOrg.row) &&
      Boolean(existingOrg.row) &&
      existingTokensGranted > 0 &&
      Number(existingOrg.row?.balance ?? 0) === initialBalance &&
      !(await findPurchaseTransaction(admin, orgId, transactionId));

    if (shouldRepairExistingGrant && existingOrg.row) {
      const repairedBalance = existingOrg.row.balance + existingTokensGranted;
      const balanceUpdate = await updateOrgBalance(admin, existingOrg.row, repairedBalance);

      if (balanceUpdate.error) {
        throw balanceUpdate.error;
      }

      const transactionInsert = await insertPurchaseTransaction(admin, {
        userId,
        orgId,
        transactionId,
        provider,
        productId: normalizedProductId || productId,
        environment,
        tokensGranted: existingTokensGranted,
        balanceAfter: repairedBalance,
        metadata,
      });

      if (transactionInsert.error) {
        console.error('Token purchase repair transaction insert failed', transactionInsert.error);
      }

      return {
        granted: true,
        tokenBalance: await readPersistedOrgBalance(),
        tokensGranted: existingTokensGranted,
      };
    }

    return {
      granted: false,
      tokenBalance: existingOrg.row?.balance ?? 0,
      tokensGranted: existingTokensGranted,
    };
  }
  if (existingGrant.error && !isMissingColumnError(existingGrant.error, 'tokens_granted')) {
    throw existingGrant.error;
  }

  const orgResult = initialOrg.row ? initialOrg : await loadOrgBalanceRow(admin, orgId);
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
    orgResult.row,
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

  const transactionInsert = await insertPurchaseTransaction(admin, {
    userId,
    orgId,
    transactionId,
    provider,
    productId: normalizedProductId || productId,
    environment,
    tokensGranted,
    balanceAfter: nextBalance,
    metadata,
  });

  if (transactionInsert.error) {
    console.error('Token transaction activity insert failed', transactionInsert.error);
  }

  const persistedBalance = await readPersistedOrgBalance();
  if (persistedBalance < nextBalance) {
    throw new Error('Token purchase was not persisted to the organization balance.');
  }

  return {
    granted: true,
    tokenBalance: persistedBalance,
    tokensGranted,
  };
}
