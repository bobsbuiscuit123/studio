"use client";

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { CreditPack } from '@/lib/credit-packs';
import { getRevenueCatOfferings, purchaseCreditsViaRevenueCat } from '@/lib/revenuecat';

export function CreditPackDialog({
  open,
  onOpenChange,
  orgId,
  title,
  description,
  onPurchased,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId?: string | null;
  title?: string;
  description?: string;
  onPurchased?: (nextBalance: number) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(false);
  const [purchasingProductId, setPurchasingProductId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void getRevenueCatOfferings()
      .then((nextPacks) => {
        if (active) {
          setPacks(nextPacks);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open]);

  const handlePurchase = async (productId: string) => {
    setPurchasingProductId(productId);
    const response = await purchaseCreditsViaRevenueCat({ productId, orgId });
    setPurchasingProductId(null);
    if (!response.ok || !response.data?.data) {
      toast({
        title: 'Credit purchase failed',
        description: response.ok ? 'Unable to add credits right now.' : response.error.message,
        variant: 'destructive',
      });
      return;
    }
    await onPurchased?.(response.data.data.newBalance);
    toast({
      title: 'Credits added',
      description: `${response.data.data.creditsAdded.toLocaleString()} credits are ready to use.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-3xl border-0 bg-white p-0 shadow-2xl">
        <DialogHeader className="border-b border-slate-100 px-6 pb-4 pt-6 text-left">
          <DialogTitle className="text-2xl">{title ?? 'Add credits'}</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {description ?? 'Choose a fixed credit pack. App Store pricing is provided by Apple at purchase time.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading credit packs...
            </div>
          ) : (
            packs.map((pack) => {
              const purchasing = purchasingProductId === pack.productId;
              return (
                <Card key={pack.productId} className="rounded-3xl border-slate-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">{pack.displayName}</CardTitle>
                        <CardDescription>{pack.displayLabel}</CardDescription>
                      </div>
                      <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        {pack.priceLabel}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      Credits are applied instantly after purchase.
                    </div>
                    <Button
                      onClick={() => handlePurchase(pack.productId)}
                      disabled={Boolean(purchasingProductId)}
                      className="rounded-2xl"
                    >
                      {purchasing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add credits'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
