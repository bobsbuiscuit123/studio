import { safeFetchJson } from '@/lib/network';
import type { CreditPack } from '@/lib/credit-packs';
import { CREDIT_PACKS } from '@/lib/credit-packs';

export const getRevenueCatOfferings = async (): Promise<CreditPack[]> => CREDIT_PACKS;

export const purchaseCreditsViaRevenueCat = async ({
  productId,
  orgId,
}: {
  productId: string;
  orgId?: string | null;
}) =>
  safeFetchJson<{
    ok: boolean;
    data?: {
      creditsAdded: number;
      newBalance: number;
      scope: 'wallet' | 'organization';
    };
  }>('/api/credits/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, orgId }),
  });
