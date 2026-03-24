'use client';

import { Capacitor } from '@capacitor/core';
import {
  Purchases,
  LOG_LEVEL,
  type PurchasesPackage,
  type PurchasesOfferings,
} from '@revenuecat/purchases-capacitor';
import { safeFetchJson } from '@/lib/network';
import { TOKEN_PACKAGES, type TokenPackage } from '@/lib/pricing';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const WALLET_POLL_ATTEMPTS = 12;
const WALLET_POLL_DELAY_MS = 1500;

export type StoreBackedTokenPackage = TokenPackage & {
  revenueCatPackage: PurchasesPackage | null;
  resolvedPriceLabel: string;
};

export type NativeApplePurchaseAvailability = {
  supported: boolean;
  reason?: string;
};

export type AppleTokenPurchaseOutcome = {
  status: 'granted' | 'pending';
  productId: string;
  transactionId: string;
  tokenBalance: number | null;
  tokensGranted: number | null;
};

type WalletActivity = {
  id: string;
  amount: number;
  type: string;
  description: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

type WalletResponse = {
  ok: boolean;
  data?: {
    tokenBalance: number;
    hasUsedTrial: boolean;
    recentTokenActivity?: WalletActivity[];
  };
};

let configuredAppUserId: string | null = null;
let configurePromise: Promise<void> | null = null;
let isConfigured = false;
let cachedOfferings: PurchasesOfferings | null = null;
let offeringsPromise: Promise<PurchasesOfferings | null> | null = null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRevenueCatAppleApiKey = () =>
  Capacitor.isNativePlatform()
    ? 'appl_THVQGIrCXAcNvtJSzvOZhctIGMc'
    : process.env.NEXT_PUBLIC_REVENUECAT_APPLE_API_KEY?.trim() ?? '';
    
export function initializeRevenueCat(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    console.log('Not native, skipping RevenueCat');
    return Promise.resolve();
  }

  if (!configurePromise) {
    configurePromise = (async () => {
      console.log('Initializing RevenueCat...');
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
      const apiKey = getRevenueCatAppleApiKey();
      console.log('RC apiKey:', apiKey);

      if (!apiKey) {
        console.error('Missing RC API key');
        configurePromise = null;
        throw new Error('Missing RC API key');
      }

      await Purchases.configure({ apiKey });
      isConfigured = true;
      console.log('RevenueCat configured');
    })().catch((error) => {
      configurePromise = null;
      console.error('RevenueCat initialization failed', error);
      throw error;
    });
  }

  return configurePromise;
}

export const isRevenueCatReady = () => isConfigured;

export const getNativeApplePurchaseAvailability =
  (): NativeApplePurchaseAvailability => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
      return {
        supported: false,
        reason: 'Apple token purchases are available only in the iOS app.',
      };
    }

    if (!getRevenueCatAppleApiKey()) {
      return {
        supported: false,
        reason: 'Apple token purchases are not configured yet.',
      };
    }

    return { supported: true };
  };

const getAuthenticatedUserId = async () => {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.id) {
    throw new Error('Sign in again before buying tokens.');
  }

  return user.id;
};

const ensureRevenueCatConfigured = async (appUserID: string) => {
  await initializeRevenueCat();

  if (!isConfigured) {
    throw new Error('RevenueCat is not configured.');
  }

  if (configuredAppUserId === appUserID) {
    return;
  }

  await Purchases.logIn({ appUserID });
  configuredAppUserId = appUserID;
};

const loadOfferings = async (): Promise<PurchasesOfferings | null> => {
  console.log('loadOfferings called');
  console.log('Capacitor.isNativePlatform:', Capacitor.isNativePlatform());

  if (cachedOfferings) {
    return cachedOfferings;
  }

  if (offeringsPromise) {
    return offeringsPromise;
  }

  const availability = getNativeApplePurchaseAvailability();
  if (!availability.supported) {
    throw new Error(availability.reason);
  }

  offeringsPromise = (async () => {
    await initializeRevenueCat();

    if (!isConfigured) {
      console.error('RevenueCat is not configured yet');
      return null;
    }

    const appUserID = await getAuthenticatedUserId();
    await ensureRevenueCatConfigured(appUserID);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      console.log('Fetching offerings attempt', attempt);
      try {
        const offerings = await Purchases.getOfferings();
        const allOfferings = offerings.all ?? {};
        const fallbackOffering =
          offerings.current || Object.values(allOfferings)[0] || null;
        const packages = fallbackOffering?.availablePackages ?? [];

        console.log('offerings:', offerings);
        console.log('packages length:', packages.length);

        if (packages.length > 0) {
          cachedOfferings = offerings;
          return offerings;
        }
      } catch (error) {
        console.error('RC error fetching offerings:', error);
        const message = error instanceof Error ? error.message : '';
        if (message.includes('None of the products could be fetched')) {
          console.error('App Store product fetch failure detected');
        }
      }

      await wait(1500);
    }

    console.error('Offerings still empty after retries');
    return null;
  })().finally(() => {
    offeringsPromise = null;
  });

  return offeringsPromise;
};

const normalizeId = (id?: string | null) => {
  if (!id) return '';
  return id.toLowerCase().replace('com.caspo.', '').replace(/\./g, '_');
};

const getPackageForProductId = (
  productId: string,
  availablePackages: PurchasesPackage[] | null
): PurchasesPackage | null => {
  if (!availablePackages?.length) {
    return null;
  }

  const target = normalizeId(productId);

  const match = availablePackages.find((pkg) => {
    const pkgId = normalizeId(pkg.identifier);
    const productIdFromRC = normalizeId(pkg.product?.identifier);

    return (
      productIdFromRC === target ||
      pkgId === target ||
      target.includes(pkgId) ||
      pkgId.includes(target)
    );
  });

  return match ?? availablePackages[0];
};

const getProviderTransactionId = (metadata?: Record<string, unknown> | null) => {
  const direct = metadata?.provider_transaction_id;
  return typeof direct === 'string' ? direct : null;
};

const registerTokenPurchaseIntent = async (
  orgId: string,
  transactionId: string,
  productId: string
) => {
  const result = await safeFetchJson('/api/orgs/' + encodeURIComponent(orgId) + '/token-purchase-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId, productId }),
    retry: { retries: 1 },
  });
  if (!result.ok) {
    const message = result.error.message || 'Failed to register token purchase intent.';
    if (
      /token_purchase_intents/i.test(message) &&
      (/does not exist/i.test(message) || /could not find the table/i.test(message))
    ) {
      console.warn('token_purchase_intents table is unavailable; continuing without purchase intent registration.');
      return false;
    }
    throw new Error(message);
  }
  return true;
};

const confirmTokenPurchaseGrant = async (
  orgId: string,
  transactionId: string,
  productId: string
) => {
  const result = await safeFetchJson<{
    ok: boolean;
    granted?: boolean;
    tokenBalance?: number | null;
    tokensGranted?: number | null;
  }>(
    '/api/orgs/' + encodeURIComponent(orgId) + '/token-purchase-confirm',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, productId }),
      retry: { retries: 1 },
    }
  );

  if (!result.ok) {
    throw new Error(result.error.message || 'Failed to confirm token purchase.');
  }

  return {
    granted: Boolean(result.data.granted),
    tokenBalance: Number(result.data.tokenBalance ?? 0),
    tokensGranted: Number(result.data.tokensGranted ?? 0),
  };
};

const waitForWalletGrant = async (
  transactionId: string,
  orgId: string,
  options?: { startingBalance?: number | null; expectedTokens?: number | null }
): Promise<Pick<AppleTokenPurchaseOutcome, 'status' | 'tokenBalance' | 'tokensGranted'>> => {
  for (let attempt = 0; attempt < WALLET_POLL_ATTEMPTS; attempt += 1) {
    const walletUrl = `/api/tokens/wallet?orgId=${encodeURIComponent(orgId)}`;
    const walletResponse = await safeFetchJson<WalletResponse>(walletUrl, {
      method: 'GET',
      timeoutMs: 10_000,
      retry: { retries: 1 },
      treatOfflineAsError: false,
    });

    if (walletResponse.ok) {
      const tokenBalance = Number(walletResponse.data.data?.tokenBalance ?? 0);
      const matchingActivity =
        walletResponse.data.data?.recentTokenActivity?.find((item) => {
          if (item.type !== 'purchase') return false;
          return getProviderTransactionId(item.metadata) === transactionId;
        }) ?? null;

      if (matchingActivity) {
        return {
          status: 'granted',
          tokenBalance,
          tokensGranted: Number(matchingActivity.amount ?? 0),
        };
      }

      const startingBalance = Number(options?.startingBalance ?? NaN);
      const expectedTokens = Number(options?.expectedTokens ?? NaN);
      if (
        Number.isFinite(startingBalance) &&
        Number.isFinite(expectedTokens) &&
        tokenBalance >= startingBalance + expectedTokens
      ) {
        return {
          status: 'granted',
          tokenBalance,
          tokensGranted: expectedTokens,
        };
      }
    }

    await wait(WALLET_POLL_DELAY_MS);
  }

  return {
    status: 'pending',
    tokenBalance: null,
    tokensGranted: null,
  };
};

const purchaseWasCancelled = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if ('userCancelled' in error && (error as { userCancelled?: boolean }).userCancelled) {
    return true;
  }

  if ('code' in error) {
    const code = String((error as { code?: string | number }).code ?? '').toLowerCase();
    return code.includes('purchase_cancelled') || code.includes('user_cancelled');
  }

  return false;
};

const purchasePackage = async (pkg: PurchasesPackage) => {
  console.log('Purchase triggered', pkg.identifier);
  return Purchases.purchasePackage({
    aPackage: pkg,
  });
};

export class ApplePurchaseCancelledError extends Error {
  constructor() {
    super('Purchase cancelled.');
    this.name = 'ApplePurchaseCancelledError';
  }
}

export const loadAppleTokenPackages = async (): Promise<StoreBackedTokenPackage[]> => {
  const availability = getNativeApplePurchaseAvailability();
  if (!availability.supported) {
    return TOKEN_PACKAGES.map((pack) => ({
      ...pack,
      revenueCatPackage: null,
      resolvedPriceLabel: pack.priceLabel,
    }));
  }

  const offerings = await loadOfferings();
  const allOfferings = offerings?.all ?? {};
  const activeOffering =
    offerings?.current || Object.values(allOfferings)[0] || null;
  const availablePackages = activeOffering?.availablePackages ?? [];
  console.log('Packages available', availablePackages.length);
  console.log(
    'Available package identifiers',
    availablePackages.map((pkg) => pkg.identifier)
  );

  return TOKEN_PACKAGES.map((pack) => {
    const revenueCatPackage = getPackageForProductId(pack.productId, availablePackages);
    return {
      ...pack,
      revenueCatPackage,
      resolvedPriceLabel: revenueCatPackage?.product.priceString ?? pack.priceLabel,
    };
  });
};

export const purchaseAppleTokenPackage = async (
  selectedPack: StoreBackedTokenPackage,
  orgId: string | null
): Promise<AppleTokenPurchaseOutcome> => {
  const availability = getNativeApplePurchaseAvailability();
  if (!availability.supported) {
    throw new Error(availability.reason);
  }

  try {
    const offerings = await loadOfferings();
    const allOfferings = offerings?.all ?? {};
    const activeOffering =
      offerings?.current || Object.values(allOfferings)[0] || null;
    const availablePackages = activeOffering?.availablePackages ?? [];
    console.log('availablePackages length:', availablePackages.length);

    const revenueCatPackage =
      selectedPack.revenueCatPackage ??
      availablePackages.find((pkg) => pkg.product.identifier === selectedPack.productId);

    if (!revenueCatPackage) {
      throw new Error('This Apple token pack is not available yet. Check RevenueCat offering.');
    }

    const purchaseResult = await purchasePackage(revenueCatPackage);
    await Purchases.syncPurchases().catch(() => undefined);

    const transactionId =
      purchaseResult.transaction?.transactionIdentifier?.trim() ||
      `${selectedPack.productId}:${Date.now()}`;

    if (!orgId) {
      throw new Error('Organization context required to assign purchased tokens.');
    }

    const initialWallet = await safeFetchJson<WalletResponse>(
      `/api/tokens/wallet?orgId=${encodeURIComponent(orgId)}`,
      { method: 'GET', timeoutMs: 10_000, retry: { retries: 1 }, treatOfflineAsError: false }
    );
    const startingBalance = initialWallet.ok
      ? Number(initialWallet.data.data?.tokenBalance ?? 0)
      : null;

    await registerTokenPurchaseIntent(orgId, transactionId, selectedPack.productId);
    try {
      const confirmedGrant = await confirmTokenPurchaseGrant(orgId, transactionId, selectedPack.productId);
      if (
        confirmedGrant.granted ||
        (startingBalance !== null && confirmedGrant.tokenBalance > startingBalance)
      ) {
        return {
          status: 'granted',
          productId: selectedPack.productId,
          transactionId,
          tokenBalance: confirmedGrant.tokenBalance,
          tokensGranted: confirmedGrant.tokensGranted || selectedPack.tokens,
        };
      }
    } catch (error) {
      console.warn('Direct token purchase confirmation failed; falling back to wallet polling.', error);
    }

    const grantResult = await waitForWalletGrant(transactionId, orgId, {
      startingBalance,
      expectedTokens: selectedPack.tokens,
    });

    return {
      productId: selectedPack.productId,
      transactionId,
      ...grantResult,
    };
  } catch (error) {
    if (purchaseWasCancelled(error)) {
      throw new ApplePurchaseCancelledError();
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Apple purchase failed. Please try again.';
    throw new Error(message);
  }
};
