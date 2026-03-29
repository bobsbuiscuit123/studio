import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function GET() {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'Credit wallets were removed. Use organization subscription status instead.',
      source: 'app',
    }),
    { status: 410 }
  );
}
