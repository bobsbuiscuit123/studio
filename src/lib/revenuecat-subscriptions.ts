'use client';

import { Capacitor } from '@capacitor/core';
import {
  LOG_LEVEL,
  Purchases,
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
} from '@revenuecat/purchases-capacitor';

import {
  REVENUECAT_ENTITLEMENT_ID,
  REVENUECAT_OFFERING_ID,
  SUBSCRIPTION_PLANS,
  getPaidPlanByPackageId,
  getPaidPlanByProductId,
  type PaidPlanId,
  type SubscriptionPlan,
} from '@/lib/pricing';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type SubscriptionPurchaseAvailability = {
  supported: boolean;
  reason?: string;
};

export type RevenueCatPlanPackage = SubscriptionPlan & {
  revenueCatPackage: PurchasesPackage | null;
  resolvedPriceLabel: string;
};

export type SubscriptionPurchaseOutcome = {
  productId: PaidPlanId;
  customerInfo: CustomerInfo;
};

let configuredAppUserId: string | null = null;
let configurePromise: Promise<string> | null = null;
let offeringsPromise: Promise<PurchasesOfferings | null> | null = null;
let cachedOfferings: PurchasesOfferings | null = null;

const getRevenueCatAppleApiKey = () =>
  process.env.NEXT_PUBLIC_REVENUECAT_APPLE_API_KEY?.trim() ?? '';

const isIosNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export const getSubscriptionPurchaseAvailability =
  (): SubscriptionPurchaseAvailability => {
    if (!isIosNative()) {
      return {
        supported: false,
        reason: 'Apple subscriptions are available only in the iOS app.',
      };
    }

    if (!getRevenueCatAppleApiKey()) {
      return {
        supported: false,
        reason: 'RevenueCat is not configured for this build yet.',
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
    throw new Error('Sign in again before managing a subscription.');
  }

  return user.id;
};

const getRevenueCatOriginalAppUserId = (customerInfo: CustomerInfo) =>
  (
    (customerInfo as CustomerInfo & { originalAppUserId?: string | null }).originalAppUserId ??
    (customerInfo as CustomerInfo & { originalAppUserID?: string | null }).originalAppUserID ??
    null
  );

const logRevenueCatCustomerIdentity = async (
  context: string,
  customerInfo?: CustomerInfo
) => {
  const resolvedCustomerInfo =
    customerInfo ?? (await Purchases.getCustomerInfo()).customerInfo;
  console.log(`RC_USER_ID [${context}]:`, getRevenueCatOriginalAppUserId(resolvedCustomerInfo));
  return resolvedCustomerInfo;
};

export const initializeRevenueCat = async (): Promise<string> => {
  const availability = getSubscriptionPurchaseAvailability();
  if (!availability.supported) {
    throw new Error(availability.reason);
  }

  const appUserID = await getAuthenticatedUserId();

  if (!configurePromise) {
    configurePromise = (async () => {
      const apiKey = getRevenueCatAppleApiKey();
      await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
      await Purchases.configure({ apiKey, appUserID });
      configuredAppUserId = appUserID;
      await logRevenueCatCustomerIdentity('configure');
      return appUserID;
    })().catch((error) => {
      configurePromise = null;
      configuredAppUserId = null;
      throw error;
    });
  }

  await configurePromise;

  if (configuredAppUserId === appUserID) {
    return appUserID;
  }

  await Purchases.logIn({ appUserID });
  configuredAppUserId = appUserID;
  await logRevenueCatCustomerIdentity('logIn');
  return appUserID;
};

const ensureRevenueCatConfigured = async () => initializeRevenueCat();

const getDefaultOfferingPackages = (offerings: PurchasesOfferings | null) => {
  const allOfferings = offerings?.all ?? {};
  const defaultOffering =
    offerings?.current ??
    allOfferings[REVENUECAT_OFFERING_ID] ??
    Object.values(allOfferings)[0] ??
    null;
  return defaultOffering?.availablePackages ?? [];
};

export const loadRevenueCatOfferings = async () => {
  const availability = getSubscriptionPurchaseAvailability();
  if (!availability.supported) {
    throw new Error(availability.reason);
  }

  if (cachedOfferings) {
    return cachedOfferings;
  }

  if (!offeringsPromise) {
    offeringsPromise = (async () => {
      await ensureRevenueCatConfigured();
      const offerings = await Purchases.getOfferings();
      cachedOfferings = offerings;
      return offerings;
    })().finally(() => {
      offeringsPromise = null;
    });
  }

  return offeringsPromise;
};

export const loadRevenueCatPlanPackages = async (): Promise<RevenueCatPlanPackage[]> => {
  const offerings = await loadRevenueCatOfferings();
  const availablePackages = getDefaultOfferingPackages(offerings);
  const paidPlans = SUBSCRIPTION_PLANS.filter((plan) => !plan.isFree);

  return paidPlans.map((plan) => {
    const revenueCatPackage =
      availablePackages.find((pkg) => {
        const planFromPackage = getPaidPlanByPackageId(pkg.identifier);
        if (planFromPackage?.id === plan.id) {
          return true;
        }
        return getPaidPlanByProductId(pkg.product.identifier)?.id === plan.id;
      }) ?? null;

    return {
      ...plan,
      revenueCatPackage,
      resolvedPriceLabel: revenueCatPackage?.product.priceString ?? plan.priceLabel,
    };
  });
};

export const getCurrentRevenueCatCustomerInfo = async (): Promise<CustomerInfo> => {
  await ensureRevenueCatConfigured();
  const { customerInfo } = await Purchases.getCustomerInfo();
  console.log('RC_USER_ID [getCustomerInfo]:', getRevenueCatOriginalAppUserId(customerInfo));
  return customerInfo;
};

export const restoreRevenueCatPurchases = async (): Promise<CustomerInfo> => {
  await ensureRevenueCatConfigured();
  const { customerInfo } = await Purchases.restorePurchases();
  console.log('RC_USER_ID [restorePurchases]:', getRevenueCatOriginalAppUserId(customerInfo));
  return customerInfo;
};

export const extractActiveProductIdFromCustomerInfo = (
  customerInfo: CustomerInfo
): PaidPlanId | null => {
  const entitlement =
    customerInfo.entitlements.active?.[REVENUECAT_ENTITLEMENT_ID] ??
    customerInfo.entitlements.all?.[REVENUECAT_ENTITLEMENT_ID];

  const entitlementProductId = getPaidPlanByProductId(
    String((entitlement as { productIdentifier?: string | null } | undefined)?.productIdentifier ?? '')
  );
  if (entitlementProductId) {
    return entitlementProductId.id;
  }

  const fromSubscriptions =
    customerInfo.activeSubscriptions
      .map((productId) => getPaidPlanByProductId(productId)?.id ?? null)
      .find((value): value is PaidPlanId => Boolean(value)) ?? null;

  return fromSubscriptions;
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

export class RevenueCatPurchaseCancelledError extends Error {
  constructor() {
    super('Purchase cancelled.');
    this.name = 'RevenueCatPurchaseCancelledError';
  }
}

export const purchaseRevenueCatPlan = async (
  revenueCatPackage: PurchasesPackage
): Promise<SubscriptionPurchaseOutcome> => {
  try {
    await ensureRevenueCatConfigured();
    const result = await Purchases.purchasePackage({ aPackage: revenueCatPackage });
    console.log(
      'RC_USER_ID [purchasePackage]:',
      getRevenueCatOriginalAppUserId(result.customerInfo)
    );
    const productId = getPaidPlanByProductId(result.productIdentifier)?.id;
    if (!productId) {
      throw new Error('RevenueCat returned an unsupported subscription product.');
    }
    return {
      productId,
      customerInfo: result.customerInfo,
    };
  } catch (error) {
    if (purchaseWasCancelled(error)) {
      throw new RevenueCatPurchaseCancelledError();
    }
    throw error instanceof Error
      ? error
      : new Error('Unable to complete the subscription purchase.');
  }
};

export const getRevenueCatManagementUrl = async () => {
  const customerInfo = await getCurrentRevenueCatCustomerInfo();
  return customerInfo.managementURL ?? null;
};
