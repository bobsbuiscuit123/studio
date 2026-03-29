import { NextResponse } from 'next/server';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export async function POST(request: Request) {
  const limiter = rateLimit(`credits-purchase:${getRequestIp(request.headers)}`, 15, 60_000);
  if (!limiter.allowed) {
    return rateLimitExceededResponse(limiter);
  }

  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'This credit purchase endpoint has been retired. Token package checkout is placeholder-only in this build.',
      source: 'app',
    }),
    { status: 410 }
  );
}
