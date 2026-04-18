import type { Session } from '@supabase/supabase-js';

import { getBrowserSessionWithTimeout } from './client';

describe('getBrowserSessionWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the browser session when it resolves in time', async () => {
    const session = { user: { id: 'user-1' } } as Session;
    const supabase: Parameters<typeof getBrowserSessionWithTimeout>[0] = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session },
        }),
      },
    };

    await expect(getBrowserSessionWithTimeout(supabase, 100)).resolves.toEqual({
      session,
      timedOut: false,
    });
  });

  it('times out instead of hanging indefinitely', async () => {
    vi.useFakeTimers();

    const supabase: Parameters<typeof getBrowserSessionWithTimeout>[0] = {
      auth: {
        getSession: vi.fn<() => Promise<{ data: { session: Session | null } }>>(
          () => new Promise(() => undefined)
        ),
      },
    };

    const resultPromise = getBrowserSessionWithTimeout(supabase, 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toEqual({
      session: null,
      timedOut: true,
    });
  });
});
