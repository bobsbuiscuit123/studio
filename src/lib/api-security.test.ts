import { describe, expect, it } from 'vitest';

import { getInternalApiUrl, getRequestIp } from './api-security';

describe('getRequestIp', () => {
  it('returns the first forwarded IP address', () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.8, 198.51.100.10',
      'x-real-ip': '198.51.100.10',
    });

    expect(getRequestIp(headers)).toBe('203.0.113.8');
  });

  it('falls back to x-real-ip or unknown', () => {
    expect(getRequestIp(new Headers({ 'x-real-ip': '198.51.100.42' }))).toBe('198.51.100.42');
    expect(getRequestIp(new Headers())).toBe('unknown');
  });
});

describe('getInternalApiUrl', () => {
  it('derives the target from the trusted request URL instead of forwarded headers', () => {
    const url = getInternalApiUrl(
      {
        url: 'https://app.example.com/api/email/ai',
      } as Pick<Request, 'url'>,
      '/api/ai/consume'
    );

    expect(url).toBe('https://app.example.com/api/ai/consume');
  });
});
