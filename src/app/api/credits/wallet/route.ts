import { NextResponse } from 'next/server';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export async function GET(request: Request) {
  const limiter = rateLimit(`credits-wallet:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!limiter.allowed) {
    return rateLimitExceededResponse(limiter);
  }

  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'Credit wallets were removed. Use organization subscription status instead.',
      source: 'app',
    }),
    { status: 410 }
  );
}
