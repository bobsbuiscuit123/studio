'use client';

import { useState } from 'react';

import { LegalDocumentDialog } from '@/components/legal-document-dialog';
import { APPLE_STANDARD_EULA_URL } from '@/lib/legal';
import { cn } from '@/lib/utils';

type SubscriptionLegalLinksProps = {
  className?: string;
};

export function SubscriptionLegalLinks({
  className,
}: SubscriptionLegalLinksProps) {
  const [legalDialog, setLegalDialog] = useState<'terms' | 'privacy' | null>(null);

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-500',
          className
        )}
      >
        <button
          type="button"
          onClick={() => setLegalDialog('privacy')}
          className="underline underline-offset-4 transition hover:text-slate-900"
        >
          Privacy Policy
        </button>
        <button
          type="button"
          onClick={() => setLegalDialog('terms')}
          className="underline underline-offset-4 transition hover:text-slate-900"
        >
          Terms of Use
        </button>
        <a
          href={APPLE_STANDARD_EULA_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 transition hover:text-slate-900"
        >
          Apple Standard EULA
        </a>
      </div>

      <LegalDocumentDialog
        open={legalDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLegalDialog(null);
          }
        }}
        type={legalDialog ?? 'terms'}
      />
    </>
  );
}
