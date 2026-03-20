import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST() {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'This credit purchase endpoint has been retired. Token package checkout is placeholder-only in this build.',
      source: 'app',
    }),
    { status: 410 }
  );
}
