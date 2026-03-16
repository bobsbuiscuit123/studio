import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'Billing self-service is not enabled yet. In-app purchases will be added later.',
      source: 'app',
    }),
    { status: 501 }
  );
}
