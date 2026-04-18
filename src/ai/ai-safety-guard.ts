type AiSafetyConfig = {
  maxCallsPerWindow: number;
  windowMs: number;
  cooldownMs: number;
  maxConcurrent: number;
};

type AiSafetyState = {
  requestTimestamps: number[];
  inFlight: number;
  blockedUntil?: number;
};

type AiSafetyPermit =
  | {
      allowed: true;
      release: () => void;
    }
  | {
      allowed: false;
      detail: string;
    };

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const normalized = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
};

const AI_SAFETY_DEFAULTS: AiSafetyConfig = {
  maxCallsPerWindow: parsePositiveInt(process.env.AI_MAX_CALLS_PER_WINDOW, 24),
  windowMs: parsePositiveInt(process.env.AI_CALL_WINDOW_MS, 60_000),
  cooldownMs: parsePositiveInt(process.env.AI_SAFETY_COOLDOWN_MS, 120_000),
  maxConcurrent: parsePositiveInt(process.env.AI_MAX_CONCURRENT_CALLS, 4),
};

declare global {
  // eslint-disable-next-line no-var
  var __aiSafetyState__: AiSafetyState | undefined;
}

const globalForAiSafety = globalThis as typeof globalThis & {
  __aiSafetyState__?: AiSafetyState;
};

const getAiSafetyState = () => {
  if (!globalForAiSafety.__aiSafetyState__) {
    globalForAiSafety.__aiSafetyState__ = {
      requestTimestamps: [],
      inFlight: 0,
    };
  }

  return globalForAiSafety.__aiSafetyState__;
};

export const getAiSafetyConfig = (): AiSafetyConfig => ({ ...AI_SAFETY_DEFAULTS });

export const resetAiSafetyStateForTests = () => {
  globalForAiSafety.__aiSafetyState__ = {
    requestTimestamps: [],
    inFlight: 0,
  };
};

export const acquireAiSafetyPermit = (
  now: number = Date.now(),
  config: AiSafetyConfig = getAiSafetyConfig()
): AiSafetyPermit => {
  const state = getAiSafetyState();
  state.requestTimestamps = state.requestTimestamps.filter(
    timestamp => now - timestamp < config.windowMs
  );

  if (typeof state.blockedUntil === 'number' && now < state.blockedUntil) {
    const remainingMs = Math.max(0, state.blockedUntil - now);
    return {
      allowed: false,
      detail: `Process-wide AI safety cooldown active for ${remainingMs}ms.`,
    };
  }

  if (state.inFlight >= config.maxConcurrent) {
    return {
      allowed: false,
      detail: `Too many concurrent AI requests. maxConcurrent=${config.maxConcurrent}`,
    };
  }

  if (state.requestTimestamps.length >= config.maxCallsPerWindow) {
    state.blockedUntil = now + config.cooldownMs;
    return {
      allowed: false,
      detail: `Process-wide AI safety limit reached. maxCallsPerWindow=${config.maxCallsPerWindow}; windowMs=${config.windowMs}; cooldownMs=${config.cooldownMs}`,
    };
  }

  state.requestTimestamps.push(now);
  state.inFlight += 1;

  let released = false;

  return {
    allowed: true,
    release: () => {
      if (released) return;
      released = true;
      state.inFlight = Math.max(0, state.inFlight - 1);
    },
  };
};
