import {
  DASHBOARD_RETRY_DELAYS_MS,
  retryWithBackoff,
  withTimeout,
} from '@/lib/dashboard-load';
import { resolveDashboardStatus } from '@/lib/dashboard-status';

describe('withTimeout', () => {
  it('resolves before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('rejects when the operation exceeds the timeout', async () => {
    await expect(
      withTimeout(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve('late'), 25);
          }),
        5
      )
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries and eventually succeeds', async () => {
    let attempts = 0;
    const resultPromise = retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('try again');
        }
        return 'done';
      },
      {
        delaysMs: DASHBOARD_RETRY_DELAYS_MS,
        retries: 2,
      }
    );

    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toBe('done');
    expect(attempts).toBe(3);
  });

  it('stops after retries are exhausted', async () => {
    let attempts = 0;
    const resultPromise = retryWithBackoff(
      async () => {
        attempts += 1;
        throw new Error('nope');
      },
      {
        delaysMs: [1, 1],
        retries: 2,
      }
    );

    const assertion = expect(resultPromise).rejects.toThrow('nope');
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempts).toBe(3);
  });
});

describe('resolveDashboardStatus', () => {
  it('returns loading for a blocking initial load', () => {
    expect(
      resolveDashboardStatus({
        clubDataStatus: 'loading',
        hasClub: true,
        hasStaleDashboardData: false,
        pageError: null,
        userStatus: 'success',
      })
    ).toBe('loading');
  });

  it('returns retrying when no data is available yet and a retry is underway', () => {
    expect(
      resolveDashboardStatus({
        clubDataStatus: 'retrying',
        hasClub: true,
        hasStaleDashboardData: false,
        pageError: null,
        userStatus: 'success',
      })
    ).toBe('retrying');
  });

  it('returns success when stale data exists during a retry', () => {
    expect(
      resolveDashboardStatus({
        clubDataStatus: 'retrying',
        hasClub: true,
        hasStaleDashboardData: true,
        pageError: null,
        userStatus: 'success',
      })
    ).toBe('success');
  });

  it('returns error when the watchdog sets a page-level error', () => {
    expect(
      resolveDashboardStatus({
        clubDataStatus: 'loading',
        hasClub: true,
        hasStaleDashboardData: false,
        pageError: 'timeout',
        userStatus: 'loading',
      })
    ).toBe('error');
  });

  it('returns empty when no group is selected', () => {
    expect(
      resolveDashboardStatus({
        clubDataStatus: 'empty',
        hasClub: false,
        hasStaleDashboardData: false,
        pageError: null,
        userStatus: 'success',
      })
    ).toBe('empty');
  });
});
