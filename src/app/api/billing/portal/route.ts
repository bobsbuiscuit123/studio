import { NextResponse } from 'next/server';
import { err } from '@/lib/result';

export async function POST(request: Request) {
  return NextResponse.json(
    err({
      code: 'VALIDATION',
      message: 'External billing portals are not used. Add fixed credit packs from the organization credits screen.',
      source: 'app',
    }),
    { status: 501 }
  );
}
