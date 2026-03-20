'use client';

import { useEffect, useMemo, useState } from 'react';
import { Coins, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { TOKEN_PACKAGES } from '@/lib/pricing';
import {
  ApplePurchaseCancelledError,
  getNativeApplePurchaseAvailability,
  loadAppleTokenPackages,
  purchaseAppleTokenPackage,
  type AppleTokenPurchaseOutcome,
  type StoreBackedTokenPackage,
} from '@/lib/token-purchases';

export function TokenPackageDialog({
  open,
  onOpenChange,
  title,
  description,
  onPurchaseComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  onPurchaseComplete?: (result: AppleTokenPurchaseOutcome) => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [packages, setPackages] = useState<StoreBackedTokenPackage[]>(() =>
    TOKEN_PACKAGES.map((pack) => ({
      ...pack,
      storeProduct: null,
      resolvedPriceLabel: pack.priceLabel,
    }))
  );
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [purchaseSubmitting, setPurchaseSubmitting] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);

  const selectedPack = useMemo(
    () => packages.find((pack) => pack.productId === selectedProductId) ?? null,
    [packages, selectedProductId]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    const availability = getNativeApplePurchaseAvailability();
    setAvailabilityMessage(availability.supported ? null : availability.reason ?? null);
    setPurchaseError(null);

    if (!availability.supported) {
      setPackages(
        TOKEN_PACKAGES.map((pack) => ({
          ...pack,
          storeProduct: null,
          resolvedPriceLabel: pack.priceLabel,
        }))
      );
      return () => {
        active = false;
      };
    }

    setLoadingPackages(true);
    void loadAppleTokenPackages()
      .then((nextPackages) => {
        if (!active) return;
        setPackages(nextPackages);
      })
      .catch((error) => {
        if (!active) return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Unable to load Apple token packages right now.';
        setPurchaseError(message);
      })
      .finally(() => {
        if (active) {
          setLoadingPackages(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedProductId(null);
      setPurchaseSubmitting(false);
      setPurchaseError(null);
    }
    onOpenChange(nextOpen);
  };

  const handlePurchase = async () => {
    if (!selectedPack) return;

    setPurchaseError(null);
    setPurchaseSubmitting(true);

    try {
      const result = await purchaseAppleTokenPackage(selectedPack);
      await onPurchaseComplete?.(result);

      toast({
        title: result.status === 'granted' ? 'Tokens added' : 'Purchase submitted',
        description:
          result.status === 'granted'
            ? `${selectedPack.displayName} added ${Number(
                result.tokensGranted ?? selectedPack.tokens
              ).toLocaleString()} tokens to your balance.`
            : 'Your Apple purchase succeeded. Tokens should appear in your balance shortly.',
      });

      handleOpenChange(false);
    } catch (error) {
      if (error instanceof ApplePurchaseCancelledError) {
        setPurchaseSubmitting(false);
        return;
      }

      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Apple purchase failed. Please try again.';
      setPurchaseError(message);
      toast({
        title: 'Purchase failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setPurchaseSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-xl rounded-3xl border-0 bg-white p-0 shadow-2xl">
          <DialogHeader className="border-b border-slate-100 px-6 pb-4 pt-6 text-left">
            <DialogTitle className="text-2xl">{title ?? 'Buy tokens'}</DialogTitle>
            <DialogDescription className="text-sm text-slate-600">
              {description ?? 'Choose a fixed token package for your organization owner account.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-6">
            {availabilityMessage ? (
              <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {availabilityMessage}
              </div>
            ) : null}
            {purchaseError ? (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {purchaseError}
              </div>
            ) : null}
            {loadingPackages ? (
              <div className="flex items-center gap-2 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading App Store prices...
              </div>
            ) : null}
            {packages.map((pack) => (
              <Card key={pack.productId} className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{pack.displayName}</CardTitle>
                      <CardDescription>{pack.displayLabel}</CardDescription>
                    </div>
                    <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {pack.resolvedPriceLabel}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Coins className="h-4 w-4 text-emerald-600" />
                    {pack.storeProduct?.description || 'Fixed Apple token package'}
                  </div>
                  <Button
                    onClick={() => setSelectedProductId(pack.productId)}
                    className="rounded-2xl"
                  >
                    Buy
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedPack)}
        onOpenChange={(nextOpen) => !nextOpen && !purchaseSubmitting && setSelectedProductId(null)}
      >
        <DialogContent className="max-w-md rounded-3xl border-0 bg-white shadow-2xl">
          <DialogHeader className="text-left">
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              Review this token package before continuing.
            </DialogDescription>
          </DialogHeader>
          {selectedPack ? (
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{selectedPack.displayName}</p>
                  <p className="text-sm text-slate-600">{selectedPack.displayLabel}</p>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {selectedPack.resolvedPriceLabel}
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">
                You will finish this purchase with Apple, then CASPO will update your token balance automatically.
              </p>
            </div>
          ) : null}
          {purchaseError ? (
            <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {purchaseError}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="rounded-2xl"
              onClick={() => setSelectedProductId(null)}
              disabled={purchaseSubmitting}
            >
              Cancel
            </Button>
            <Button
              className="rounded-2xl"
              onClick={() => void handlePurchase()}
              disabled={purchaseSubmitting || Boolean(availabilityMessage) || loadingPackages}
            >
              {purchaseSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buying...
                </>
              ) : (
                'Buy'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
