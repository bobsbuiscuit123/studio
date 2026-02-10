'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/telemetry';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    captureException(error, { digest: error.digest, scope: 'global-error' });
  }, [error]);

  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-2xl font-semibold">We hit an unexpected error</h1>
          <p className="text-sm text-muted-foreground">
            Please refresh the page. If the issue persists, restart the app.
          </p>
        </div>
      </body>
    </html>
  );
}

