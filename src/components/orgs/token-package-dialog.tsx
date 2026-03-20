'use client';

import { Coins } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

  const handlePlaceholderPurchase = () => {
    toast({
      title: 'Token purchases coming soon',
      description: 'Apple token package checkout is still placeholder-only in this build.',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-3xl border-0 bg-white p-0 shadow-2xl">
        <DialogHeader className="border-b border-slate-100 px-6 pb-4 pt-6 text-left">
          <DialogTitle className="text-2xl">{title ?? 'Buy tokens'}</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {description ?? 'Fixed Apple token packages will appear here. App Store checkout is not wired in yet.'}
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
                <Button onClick={handlePlaceholderPurchase} className="rounded-2xl">
                  Coming soon
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
