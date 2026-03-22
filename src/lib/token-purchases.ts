'use client';

import { Capacitor } from '@capacitor/core';
import {
  Purchases,
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
let cachedOfferings: PurchasesOfferings | null = null;
let offeringsPromise: Promise<PurchasesOfferings> | null = null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRevenueCatAppleApiKey = () =>
  process.env.NEXT_PUBLIC_REVENUECAT_APPLE_API_KEY?.trim() ?? '';

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
  if (configuredAppUserId === appUserID) {
    return;
  }

  if (!configurePromise) {
    configurePromise = (async () => {
      const apiKey = getRevenueCatAppleApiKey();
      if (!apiKey) {
        throw new Error('Missing RevenueCat Apple API key.');
      }

      let isConfigured = false;
      try {
        const result = await Purchases.isConfigured();
        isConfigured = result.isConfigured;
      } catch {
        isConfigured = false;
      }

      if (!isConfigured) {
        await Purchases.configure({
          apiKey,
          appUserID,
        });
        configuredAppUserId = appUserID;
        return;
      }

      const { appUserID: currentAppUserID } = await Purchases.getAppUserID();
      if (currentAppUserID !== appUserID) {
        await Purchases.logIn({ appUserID });
      }
      configuredAppUserId = appUserID;
    })().finally(() => {
      configurePromise = null;
    });
  }

  await configurePromise;

  if (configuredAppUserId !== appUserID) {
    await Purchases.logIn({ appUserID });
    configuredAppUserId = appUserID;
  }
};

const loadOfferings = async (): Promise<PurchasesOfferings> => {
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

  const appUserID = await getAuthenticatedUserId();
  await ensureRevenueCatConfigured(appUserID);

  offeringsPromise = Purchases.getOfferings()
    .then((offerings) => {
      console.log('Offerings loaded');
      console.log('offerings.current?.identifier', offerings.current?.identifier);
      console.log(
        'availablePackages',
        (offerings.current?.availablePackages ?? []).map((pkg) => ({
          pkgIdentifier: pkg.identifier,
          productIdentifier: pkg.product.identifier,
        }))
      );
      cachedOfferings = offerings;
      return offerings;
    })
    .finally(() => {
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

const waitForWalletGrant = async (
  transactionId: string
): Promise<Pick<AppleTokenPurchaseOutcome, 'status' | 'tokenBalance' | 'tokensGranted'>> => {
  for (let attempt = 0; attempt < WALLET_POLL_ATTEMPTS; attempt += 1) {
    const walletResponse = await safeFetchJson<WalletResponse>('/api/tokens/wallet', {
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
  const availablePackages = offerings.current?.availablePackages ?? [];
  console.log('Packages available', availablePackages.length);

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
  selectedPack: StoreBackedTokenPackage
): Promise<AppleTokenPurchaseOutcome> => {
  const availability = getNativeApplePurchaseAvailability();
  if (!availability.supported) {
    throw new Error(availability.reason);
  }

  try {
    const revenueCatPackage =
      selectedPack.revenueCatPackage ??
      (await loadOfferings()).current?.availablePackages.find(
        (pkg) => pkg.product.identifier === selectedPack.productId
      );

    if (!revenueCatPackage) {
      throw new Error('This Apple token pack is not available yet. Check RevenueCat offering.');
    }

    const purchaseResult = await purchasePackage(revenueCatPackage);
    await Purchases.syncPurchases().catch(() => undefined);

    const transactionId =
      purchaseResult.transaction?.transactionIdentifier?.trim() ||
      `${selectedPack.productId}:${Date.now()}`;

    const grantResult = await waitForWalletGrant(transactionId);

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
