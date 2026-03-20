'use client';

import { useState } from 'react';
import { Coins } from 'lucide-react';
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

export function TokenPackageDialog({
  open,
  onOpenChange,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
}) {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const selectedPack =
    TOKEN_PACKAGES.find(pack => pack.productId === selectedProductId) ?? null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedProductId(null);
    }
    onOpenChange(nextOpen);
  };

  const handlePlaceholderPurchase = () => {
    if (!selectedPack) return;

    toast({
      title: 'Purchase confirmed',
      description: `${selectedPack.displayName} has been selected for purchase in this build.`,
    });
    setSelectedProductId(null);
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
          {TOKEN_PACKAGES.map((pack) => (
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
                  <Coins className="h-4 w-4 text-emerald-600" />
                  Fixed token package
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
    <Dialog open={Boolean(selectedPack)} onOpenChange={(nextOpen) => !nextOpen && setSelectedProductId(null)}>
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
                {selectedPack.priceLabel}
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-600">
              Review this package, then tap Buy again to confirm your selection.
            </p>
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="rounded-2xl" onClick={() => setSelectedProductId(null)}>
            Cancel
          </Button>
          <Button className="rounded-2xl" onClick={handlePlaceholderPurchase}>
            Buy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
