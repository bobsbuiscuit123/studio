import { NextResponse } from 'next/server';

import { err } from '@/lib/result';
import { getRateLimitHeaders, type RateLimitResult } from '@/lib/rate-limit';

export const getRequestIp = (headers: Headers) =>
  headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
  headers.get('x-real-ip') ||
  'unknown';

export const getInternalApiUrl = (
  request: Pick<Request, 'url'>,
  pathname: `/${string}`
) => new URL(pathname, request.url).toString();

export const rateLimitExceededResponse = (
  result: RateLimitResult,
  message = 'Too many requests. Please slow down.'
) =>
  NextResponse.json(
    err({
      code: 'NETWORK_HTTP_ERROR',
      message,
      source: 'network',
    }),
    {
      status: 429,
      headers: getRateLimitHeaders(result),
    }
  );
