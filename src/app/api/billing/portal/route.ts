import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'App Store subscriptions are managed by Apple. Open organization billing in the iOS app to restore or change your plan.',
      source: 'app',
    }),
    { status: 501 }
  );
}
