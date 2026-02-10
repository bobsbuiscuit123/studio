'use server';

import { NextResponse } from 'next/server';
import { addCalendarEvent } from '@/ai/flows/add-calendar-event';
import { runWithAiAction } from '@/ai/ai-action-context';
import { err } from '@/lib/result';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { z } from 'zod';
import { enforceAiQuota } from '@/lib/ai-quota';

export async function POST(request: Request) {
  return runWithAiAction('calendarAiRoute', async () => {
    try {
      const headerList = await headers();
      const ip =
        headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        headerList.get('x-real-ip') ||
        'unknown';
      const limiter = rateLimit(`calendar-ai:${ip}`, 20, 60_000);
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
        prompt: z.string().min(5, 'Prompt is required.'),
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
      const quota = await enforceAiQuota();
      if (!quota.ok) {
        return NextResponse.json(quota, {
          status: 429,
          headers: getRateLimitHeaders(limiter),
        });
      }
      const prompt = parsed.data.prompt;
      if (!prompt || prompt.length < 5) {
        return NextResponse.json(
          err({
            code: 'VALIDATION',
            message: 'Prompt is required.',
            source: 'app',
          }),
          { status: 400 }
        );
      }
      const result = await addCalendarEvent({ prompt });
      const status = result.ok ? 200 : 502;
      return NextResponse.json(result, {
        status,
        headers: getRateLimitHeaders(limiter),
      });
    } catch (error: any) {
      console.error('Calendar AI route error:', error);
      return NextResponse.json(
        err({
          code: 'UNKNOWN',
          message: error?.message ?? 'Failed to add event.',
          source: 'app',
        }),
        { status: 500 }
      );
    }
  });
}
