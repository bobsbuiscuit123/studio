import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function GET() {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'This credit wallet endpoint has been retired. Use /api/tokens/wallet instead.',
      source: 'app',
    }),
    { status: 410 }
  );
}
