import { safeFetchJson } from '@/lib/network';

describe('safeFetchJson', () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      // @ts-expect-error - clean up stub
      delete globalThis.fetch;
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    } else {
      // @ts-expect-error - clean up stub
      delete globalThis.navigator;
    }
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    } else {
      // @ts-expect-error - clean up stub
      delete globalThis.window;
    }
  });

  it('returns offline error when navigator reports offline', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    const result = await safeFetchJson('https://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_OFFLINE');
    }
  });

  it('returns parsed json on success', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ value: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await safeFetchJson<{ value: number }>('https://example.com');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.value).toBe(42);
    }
  });

  it('adds the browser timezone header to requests', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-timezone')).toBe('America/Chicago');
      return new Response(JSON.stringify({ value: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const originalDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeFormatMock = vi.fn(() => ({
      resolvedOptions: () => ({ timeZone: 'America/Chicago' }),
    }));
    Intl.DateTimeFormat = dateTimeFormatMock as unknown as typeof Intl.DateTimeFormat;

    try {
      const result = await safeFetchJson<{ value: number }>('https://example.com');
      expect(result.ok).toBe(true);
    } finally {
      Intl.DateTimeFormat = originalDateTimeFormat;
    }
  });

  it('reads string error payloads from non-2xx responses', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: false, error: 'Email already in use.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await safeFetchJson('https://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Email already in use.');
    }
  });

  it('propagates request ids to the request headers', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-request-id')).toBe('req-123');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await safeFetchJson<{ ok: boolean }>('https://example.com', {
      requestId: 'req-123',
    });

    expect(result.ok).toBe(true);
  });

  it('honors an externally provided abort signal', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
    });

    globalThis.fetch = vi.fn(async (_input, init) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          },
          { once: true }
        );
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const requestPromise = safeFetchJson('https://example.com', {
      signal: controller.signal,
      timeoutMs: 100,
    });
    controller.abort();

    const result = await requestPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK_TIMEOUT');
    }
  });
});
