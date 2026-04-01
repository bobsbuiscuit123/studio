import Link from 'next/link';

import { APPLE_STANDARD_EULA_URL } from '@/lib/legal';
import { cn } from '@/lib/utils';

type SubscriptionLegalLinksProps = {
  className?: string;
};

export function SubscriptionLegalLinks({
  className,
}: SubscriptionLegalLinksProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-500',
        className
      )}
    >
      <Link
        href="/privacy"
        className="underline underline-offset-4 transition hover:text-slate-900"
      >
        Privacy Policy
      </Link>
      <Link
        href="/terms"
        className="underline underline-offset-4 transition hover:text-slate-900"
      >
        Terms of Use
      </Link>
      <a
        href={APPLE_STANDARD_EULA_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 transition hover:text-slate-900"
      >
        Apple Standard EULA
      </a>
    </div>
  );
}
