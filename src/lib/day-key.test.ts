import { getDayKeyForTimeZone, getRequestDayKey } from '@/lib/day-key';

describe('day-key helpers', () => {
  it('formats the day key for the provided time zone', () => {
    const date = new Date('2026-03-17T04:30:00.000Z');

    expect(getDayKeyForTimeZone('America/Chicago', date)).toBe('2026-03-16');
    expect(getDayKeyForTimeZone('UTC', date)).toBe('2026-03-17');
  });

  it('prefers the request timezone header when present', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-timezone': 'America/Chicago',
      },
    });

    expect(getRequestDayKey(request, new Date('2026-03-17T04:30:00.000Z'))).toBe('2026-03-16');
  });

  it('falls back to the timezone cookie when the header is missing', () => {
    const request = new Request('https://example.com', {
      headers: {
        cookie: 'client-timezone=America%2FChicago',
      },
    });

    expect(getRequestDayKey(request, new Date('2026-03-17T04:30:00.000Z'))).toBe('2026-03-16');
  });
});
