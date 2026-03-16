import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'Legacy checkout has been removed. Use /api/orgs/create for the IAP-ready flow.',
      source: 'app',
    }),
    { status: 410 }
  );
}
