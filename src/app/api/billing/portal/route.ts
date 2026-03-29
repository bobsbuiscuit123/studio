import { NextResponse } from 'next/server';
import { err } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';

export async function POST(request: Request) {
  const limiter = rateLimit(`billing-portal:${getRequestIp(request.headers)}`, 15, 60_000);
  if (!limiter.allowed) {
    return rateLimitExceededResponse(limiter);
  }

  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'App Store subscriptions are managed by Apple. Open organization billing in the iOS app to restore or change your plan.',
      source: 'app',
    }),
    { status: 501 }
  );
}
