import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'External billing portals are not used. Token packages are handled in-app.',
      source: 'app',
    }),
    { status: 501 }
  );
}
