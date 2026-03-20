import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'Organization creation is free. Use /api/orgs/create and add credits separately when needed.',
      source: 'app',
    }),
    { status: 410 }
  );
}
