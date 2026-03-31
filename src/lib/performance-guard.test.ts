import { startPerformanceTimer, warnForSlowPath } from '@/lib/performance-guard';

describe('performance guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns when a path exceeds the configured threshold', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const didWarn = warnForSlowPath('group state fetch', 1500, 1000, {
      route: '/dashboard',
    });

    expect(didWarn).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith('[perf] Slow group state fetch', {
      durationMs: 1500,
      thresholdMs: 1000,
      route: '/dashboard',
    });
  });

  it('does not warn when a path stays under threshold', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const didWarn = warnForSlowPath('group state fetch', 400, 1000);

    expect(didWarn).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('measures elapsed time through the timer helper', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(2_650);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const timer = startPerformanceTimer('fetch json', 1200, { method: 'GET' });
    const durationMs = timer.stop({ path: '/api/org-state' });

    expect(durationMs).toBe(1650);
    expect(warnSpy).toHaveBeenCalledWith('[perf] Slow fetch json', {
      durationMs: 1650,
      thresholdMs: 1200,
      method: 'GET',
      path: '/api/org-state',
    });
  });
});
