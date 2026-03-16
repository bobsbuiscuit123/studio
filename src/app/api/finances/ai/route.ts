'use server';

import { NextResponse } from 'next/server';
import { runWithAiAction } from '@/ai/ai-action-context';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { z } from 'zod';

export async function POST(request: Request) {
  return runWithAiAction('financesAiRoute', async () => {
    try {
      const headerList = await headers();
      const ip =
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headerList.get('x-real-ip') ||
        'unknown';
      const limiter = rateLimit(`finances-ai:${ip}`, 15, 60_000);
      if (!limiter.allowed) {
        return NextResponse.json(
          err({
            code: 'NETWORK_HTTP_ERROR',
            message: 'Too many requests. Please slow down.',
            source: 'network',
          }),
          { status: 429, headers: getRateLimitHeaders(limiter) }
        );
      }

      const body = await request.json().catch(() => ({}));
      const schema = z.object({
        prompt: z.string().min(3, 'Prompt is required.'),
      });
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          err({
            code: 'VALIDATION',
            message: parsed.error.errors[0]?.message ?? 'Prompt is required.',
            source: 'app',
          }),
          { status: 400, headers: getRateLimitHeaders(limiter) }
        );
      }
      const origin =
        headerList.get('origin') ||
        `${headerList.get('x-forwarded-proto') || 'http'}://${headerList.get('x-forwarded-host') || 'localhost:3000'}`;
      const response = await fetch(`${origin}/api/ai/consume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: headerList.get('cookie') ?? '',
        },
        body: JSON.stringify({
          feature: 'chat',
          action: 'transaction',
          payload: { prompt: parsed.data.prompt },
        }),
      });
      const json = await response.json().catch(() => null);
      return NextResponse.json(json ?? err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Invalid server response.',
        source: 'network',
      }), {
        status: response.status,
        headers: getRateLimitHeaders(limiter),
      });
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: string }).message)
          : 'Failed to add transaction.';
      return NextResponse.json(
        err({
          code: 'UNKNOWN',
          message,
          source: 'app',
        }),
        { status: 500 }
      );
    }
  });
}
