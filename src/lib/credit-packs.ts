export type CreditPackKind = 'starter' | 'growth' | 'scale';

export type CreditPack = {
  kind: CreditPackKind;
  productId: string;
  credits: number;
  displayName: string;
  displayLabel: string;
  priceLabel: string;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    kind: 'starter',
    productId: 'caspo_credits_500',
    credits: 500,
    displayName: 'Starter Credits',
    displayLabel: '500 Credits',
    priceLabel: 'App Store price',
  },
  {
    kind: 'growth',
    productId: 'caspo_credits_1500',
    credits: 1500,
    displayName: 'Growth Credits',
    displayLabel: '1,500 Credits',
    priceLabel: 'App Store price',
  },
  {
    kind: 'scale',
    productId: 'caspo_credits_4000',
    credits: 4000,
    displayName: 'Scale Credits',
    displayLabel: '4,000 Credits',
    priceLabel: 'App Store price',
  },
];

export const getCreditPackByProductId = (productId: string) =>
  CREDIT_PACKS.find((pack) => pack.productId === productId) ?? null;
