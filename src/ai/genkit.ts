import 'server-only';
import type { z } from 'zod';
import { recordGeminiRequest } from '@/ai/ai-action-context';
import { clampAiOutputChars } from '@/lib/ai-output-limit';
import { err, ok, type AppError, type Result } from '@/lib/result';
import { addBreadcrumb, captureException } from '@/lib/telemetry';

export type Provider = 'gemini' | 'openrouter' | 'openai';

export type AiError = AppError & {
  provider: Provider;
  model?: string;
};

const providerEnv = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const provider: Provider =
  providerEnv === 'openrouter'
    ? 'openrouter'
    : providerEnv === 'openai'
      ? 'openai'
      : 'gemini';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string;
};

// Keep a cap so prompts stay bounded, but allow enough room for multi-step
// app flows that include scoped context from group_state.
const MAX_APP_AI_PROMPT_CHARS = 12_000;

// Gemini setup (only validated when provider is gemini)
const geminiKey =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_GENAI_API_KEY ??
  process.env.GOOGLE_API_KEY;
const DEFAULT_GEMINI_MODEL = 'models/gemini-2.5-flash';
const normalizeGeminiModel = (model?: string) => {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) return DEFAULT_GEMINI_MODEL;
  return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`;
};
const GEMINI_MODEL = normalizeGeminiModel(process.env.GEMINI_MODEL);

// OpenRouter setup
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

// OpenAI setup
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

const aiConfigError =
  provider === 'gemini' && !geminiKey
    ? 'Missing Gemini API key. Set GEMINI_API_KEY (or GOOGLE_GENAI_API_KEY / GOOGLE_API_KEY) in .env.local.'
    : provider === 'openrouter' && !OPENROUTER_API_KEY
      ? 'Missing OPENROUTER_API_KEY in .env.local.'
      : provider === 'openai' && !OPENAI_API_KEY
        ? 'Missing OPENAI_API_KEY in .env.local.'
        : null;

const aiDisabledByEnv = process.env.AI_ENABLED === 'false';
export const aiEnabled = !aiConfigError && !aiDisabledByEnv;
const isDebugLoggingEnabled = process.env.NODE_ENV !== 'production';

if (aiConfigError) {
  console.warn(`[AI_DEBUG] AI disabled: ${aiConfigError}`);
}

type GenkitInstance = ReturnType<(typeof import('genkit'))['genkit']>;
type GeminiModules = {
  genkitModule: typeof import('genkit');
  googleAIModule: typeof import('@genkit-ai/googleai');
};

declare global {
  // eslint-disable-next-line no-var
  var __genkit_ai__: GenkitInstance | undefined;
}

const globalForGenkit = globalThis as typeof globalThis & {
  __genkit_ai__?: GenkitInstance;
  __aiQuotaBlockedUntil?: number;
  __aiQuotaConsecutive429?: number;
  __aiCircuitState?: {
    failures: number;
    blockedUntil?: number;
    lastErrorCode?: string;
  };
};
let geminiModulesPromise: Promise<GeminiModules | null> | null = null;

const loadGeminiModules = async (): Promise<GeminiModules | null> => {
  if (provider !== 'gemini' || !aiEnabled) return null;
  if (typeof window !== 'undefined') return null;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') {
    return null;
  }
  if (!geminiModulesPromise) {
    geminiModulesPromise = Promise.all([
      import(/* webpackIgnore: true */ 'genkit'),
      import(/* webpackIgnore: true */ '@genkit-ai/googleai'),
    ]).then(([genkitModule, googleAIModule]) => ({
      genkitModule,
      googleAIModule,
    }));
  }
  return geminiModulesPromise;
};

const getAiInstance = async (): Promise<GenkitInstance | null> => {
  if (globalForGenkit.__genkit_ai__) return globalForGenkit.__genkit_ai__;
  const modules = await loadGeminiModules();
  if (!modules) return null;
  const { genkit } = modules.genkitModule;
  const { googleAI } = modules.googleAIModule;
  globalForGenkit.__genkit_ai__ = genkit({
    plugins: [googleAI({ apiKey: geminiKey! })],
    model: googleAI.model(GEMINI_MODEL),
  });
  return globalForGenkit.__genkit_ai__ ?? null;
};

export const activeProvider = provider;
export const activeModelName =
  provider === 'openrouter' ? OPENROUTER_MODEL : provider === 'openai' ? OPENAI_MODEL : GEMINI_MODEL;

export function logAiEnvDebug(callSite?: string) {
  if (!isDebugLoggingEnabled) return;
  const keyPresent =
    provider === 'openrouter'
      ? Boolean(OPENROUTER_API_KEY)
      : provider === 'openai'
        ? Boolean(OPENAI_API_KEY)
        : Boolean(geminiKey);
  const suffix = callSite ? ` | callsite=${callSite}` : '';
  console.info(
    `[AI_DEBUG] provider=${provider} | model=${activeModelName} | key_present=${keyPresent} | enabled=${aiEnabled}${suffix}`
  );
}

const AI_CIRCUIT_FAILURE_THRESHOLD = 3;
const AI_CIRCUIT_COOLDOWN_MS = 60_000;

const getCircuitState = () => {
  if (!globalForGenkit.__aiCircuitState) {
    globalForGenkit.__aiCircuitState = { failures: 0 };
  }
  return globalForGenkit.__aiCircuitState;
};

const isCircuitOpen = () => {
  const state = getCircuitState();
  return typeof state.blockedUntil === 'number' && Date.now() < state.blockedUntil;
};

const recordCircuitFailure = (code: string) => {
  const state = getCircuitState();
  state.failures += 1;
  state.lastErrorCode = code;
  if (state.failures >= AI_CIRCUIT_FAILURE_THRESHOLD) {
    state.blockedUntil = Date.now() + AI_CIRCUIT_COOLDOWN_MS;
    if (isDebugLoggingEnabled) {
      console.info(
        `[AI_DEBUG] AI circuit opened | failures=${state.failures} | cooldownMs=${AI_CIRCUIT_COOLDOWN_MS}`
      );
    }
  }
};

const recordCircuitSuccess = () => {
  const state = getCircuitState();
  if (isDebugLoggingEnabled && (state.failures > 0 || state.blockedUntil)) {
    console.info('[AI_DEBUG] AI circuit reset after success');
  }
  state.failures = 0;
  state.blockedUntil = undefined;
  state.lastErrorCode = undefined;
};

const makeAiError = (
  code: AppError['code'],
  message: string,
  detail?: string,
  retryable = false
): AiError => ({
  code,
  message,
  detail,
  retryable,
  source: 'ai',
  provider,
  model: activeModelName,
});

const mapAiError = (error: unknown): AiError => {
  if (aiConfigError) {
    return makeAiError('AI_DISABLED', aiConfigError, undefined, false);
  }
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: string }).message)
        : 'AI request failed.';
  if (/timed out|timeout|AbortError/i.test(message)) {
    return makeAiError('AI_TIMEOUT', 'AI request timed out. Please try again.', message, true);
  }
  if (/quota exceeded|too many requests|429/i.test(message)) {
    return makeAiError('AI_QUOTA', 'AI quota is temporarily unavailable.', message, true);
  }
  if (/invalid json|empty response|bad response/i.test(message)) {
    return makeAiError('AI_BAD_RESPONSE', 'AI returned an invalid response.', message, true);
  }
  if (/schema|validation|ZodError/i.test(message)) {
    return makeAiError('AI_SCHEMA_INVALID', 'AI response validation failed.', message, true);
  }
  return makeAiError('AI_PROVIDER_ERROR', 'AI request failed. Please try again.', message, true);
};

function normalizeMessagesForGenkit(messages: ChatMessage[]) {
  return messages.map(m => {
    const role = m.role === 'assistant' ? 'model' : m.role === 'developer' ? 'system' : m.role;
    return {
      role: role as 'system' | 'user' | 'model' | 'tool',
      content: [{ text: redactPII(m.content) }],
    };
  });
}

const clampMessagesToTotalChars = (messages: ChatMessage[], maxChars: number) => {
  if (maxChars <= 0) {
    return messages.map(message => ({ ...message, content: '' }));
  }

  let remaining = maxChars;
  const next = [...messages];

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index];
    const content = String(message.content ?? '');
    if (remaining <= 0) {
      next[index] = { ...message, content: '' };
      continue;
    }
    if (content.length <= remaining) {
      remaining -= content.length;
      continue;
    }
    next[index] = {
      ...message,
      content: content.slice(content.length - remaining),
    };
    remaining = 0;
  }

  return next;
};

const redactPII = (value: string) => {
  const emailRedacted = value.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    '[redacted-email]'
  );
  const phoneRedacted = emailRedacted.replace(
    /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g,
    '[redacted-phone]'
  );
  return phoneRedacted;
};

async function callOpenRouterChat(options: {
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: 'json_object';
  modelOverride?: string;
  timeoutMs?: number;
}) {
  if (provider !== 'openrouter') {
    throw new Error('OpenRouter provider is not active.');
  }

  const { messages, temperature = 0.4, responseFormat, modelOverride, timeoutMs = 30_000 } = options;
  const model = modelOverride || OPENROUTER_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'CASPO Sandbox',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: responseFormat ? { type: responseFormat } : undefined,
    }),
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('OpenRouter returned an empty response.');
  }
  return content.trim();
}

async function callOpenAIChat(options: {
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: 'json_object';
  modelOverride?: string;
  timeoutMs?: number;
}) {
  if (provider !== 'openai') {
    throw new Error('OpenAI provider is not active.');
  }

  const { messages, temperature = 0.4, responseFormat, modelOverride, timeoutMs = 30_000 } = options;
  const model = modelOverride || OPENAI_MODEL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: responseFormat ? { type: responseFormat } : undefined,
    }),
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('OpenAI returned an empty response.');
  }
  return content.trim();
}

function safeJsonParse<T>(content: string): Result<T> {
  try {
    return ok(JSON.parse(content) as T);
  } catch (error) {
    return err(
      makeAiError(
        'AI_BAD_RESPONSE',
        'AI returned invalid JSON. Please try again.',
        String(error),
        true
      )
    );
  }
}

export async function callAI<TOutput>(options: {
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: 'json_object';
  modelOverride?: string;
  outputSchema: z.ZodType<TOutput>;
  maxOutputChars?: number;
  timeoutMs?: number;
}): Promise<Result<TOutput>>;
export async function callAI(options: {
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: 'json_object';
  modelOverride?: string;
  outputSchema?: undefined;
  maxOutputChars?: number;
  timeoutMs?: number;
}): Promise<Result<string>>;
export async function callAI<TOutput>(options: {
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: 'json_object';
  modelOverride?: string;
  outputSchema?: z.ZodType<TOutput>;
  maxOutputChars?: number;
  timeoutMs?: number;
}): Promise<Result<TOutput | string>> {
  const {
    messages,
    temperature,
    responseFormat,
    modelOverride,
    outputSchema,
    maxOutputChars,
    timeoutMs,
  } = options;
  logAiEnvDebug();

  if (!aiEnabled) {
    return err(makeAiError('AI_DISABLED', aiConfigError ?? 'AI is unavailable.'));
  }

  const wantsJson = responseFormat === 'json_object' || Boolean(outputSchema);
  const effectiveResponseFormat = wantsJson ? 'json_object' : undefined;
  const effectiveModelName =
    provider === 'gemini' ? GEMINI_MODEL : modelOverride ?? activeModelName;

  addBreadcrumb('AI request', {
    provider,
    model: effectiveModelName,
    wantsJson,
  });

  const inFlightKey = JSON.stringify({
    provider,
    model: effectiveModelName,
    responseFormat: effectiveResponseFormat ?? null,
    temperature: temperature ?? 0.4,
    wantsJson,
    messages,
  });

  const timeoutValue = timeoutMs ?? 12_000;
  const useTimeout = typeof timeoutValue === 'number' && timeoutValue > 0;

  const inFlightMap =
    (globalForGenkit as typeof globalForGenkit & {
      __inFlightAi__?: Map<string, Promise<Result<TOutput | string>>>;
    }).__inFlightAi__ ??
    ((globalForGenkit as typeof globalForGenkit & {
      __inFlightAi__?: Map<string, Promise<Result<TOutput | string>>>;
    }).__inFlightAi__ = new Map());

  if (inFlightMap.has(inFlightKey)) {
    return inFlightMap.get(inFlightKey)!;
  }

  if (isCircuitOpen()) {
    return err(
      makeAiError(
        'AI_DISABLED',
        'AI is temporarily unavailable. Please try again shortly.'
      )
    );
  }

  const isDev = process.env.NODE_ENV !== 'production';
  if (
    !isDev &&
    typeof globalForGenkit.__aiQuotaBlockedUntil === 'number' &&
    Date.now() < globalForGenkit.__aiQuotaBlockedUntil
  ) {
    const remainingMs = globalForGenkit.__aiQuotaBlockedUntil - Date.now();
    if (isDebugLoggingEnabled) {
      console.info(
        `[AI_DEBUG] Gemini cooldown active | remainingMs=${Math.max(0, remainingMs)}`
      );
    }
    return err(
      makeAiError(
        'AI_QUOTA',
        'AI quota is temporarily unavailable. Please try again shortly.',
        `remainingMs=${Math.max(0, remainingMs)}`,
        true
      )
    );
  } else if (
    isDev &&
    typeof globalForGenkit.__aiQuotaBlockedUntil === 'number' &&
    Date.now() < globalForGenkit.__aiQuotaBlockedUntil
  ) {
    const remainingMs = globalForGenkit.__aiQuotaBlockedUntil - Date.now();
    if (isDebugLoggingEnabled) {
      console.info(
        `[AI_DEBUG] Gemini cooldown ignored in dev | remainingMs=${Math.max(0, remainingMs)}`
      );
    }
  }

  const blockQuota = (error: unknown) => {
    const message =
      typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message: string }).message)
          : '';
    if (/quota exceeded|too many requests|429/i.test(message)) {
      const consecutive = (globalForGenkit.__aiQuotaConsecutive429 ?? 0) + 1;
      globalForGenkit.__aiQuotaConsecutive429 = consecutive;
      if (consecutive >= 2) {
        const cooldownMs = Math.min(10_000, 8_000);
        globalForGenkit.__aiQuotaBlockedUntil = Date.now() + cooldownMs;
        if (isDebugLoggingEnabled) {
          console.info(
            `[AI_DEBUG] Gemini cooldown set | consecutive429=${consecutive} | cooldownMs=${cooldownMs}`
          );
        }
      } else {
        if (isDebugLoggingEnabled) {
          console.info(
            `[AI_DEBUG] Gemini 429 detected | consecutive429=${consecutive} | cooldown not set`
          );
        }
      }
      return;
    }
    globalForGenkit.__aiQuotaConsecutive429 = 0;
  };

  const clearQuotaCooldown = () => {
    if (
      isDebugLoggingEnabled &&
      typeof globalForGenkit.__aiQuotaBlockedUntil === 'number'
    ) {
      console.info('[AI_DEBUG] Gemini cooldown cleared after success');
    }
    globalForGenkit.__aiQuotaBlockedUntil = undefined;
    globalForGenkit.__aiQuotaConsecutive429 = 0;
  };

  const redactedMessages = messages.map(message => ({
    ...message,
    content: redactPII(message.content),
  }));
  const cappedMessages = clampMessagesToTotalChars(
    redactedMessages,
    MAX_APP_AI_PROMPT_CHARS
  );

  const applyOutputCharLimit = <TValue>(value: TValue): TValue => {
    if (typeof maxOutputChars !== 'number' || maxOutputChars < 0) {
      return value;
    }

    return clampAiOutputChars(value, maxOutputChars);
  };

  const run = async () => {
    if (provider === 'gemini') {
      const modules = await loadGeminiModules();
      const ai = await getAiInstance();
      if (!modules || !ai) {
        return err(
          makeAiError('AI_DISABLED', 'Gemini provider is not initialized.')
        );
      }
      const { googleAI } = modules.googleAIModule;
      const resolvedGeminiModel = GEMINI_MODEL;
      const keyPresent = Boolean(geminiKey);
      if (isDebugLoggingEnabled) {
        console.info(
          `[AI_DEBUG] GEMINI_MODEL=${resolvedGeminiModel} | key_present=${keyPresent}`
        );
      }
      recordGeminiRequest(resolvedGeminiModel, keyPresent);
      let res: Awaited<ReturnType<typeof ai.generate>>;
      try {
        const request = ai.generate({
          messages: normalizeMessagesForGenkit(cappedMessages),
          config: { temperature: temperature ?? 0.4 },
          output: outputSchema ? { schema: outputSchema } : undefined,
          model: googleAI.model(resolvedGeminiModel),
        });
        res = (useTimeout
          ? await Promise.race([
              request,
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error('AI request timed out. Please try again.')),
                  timeoutValue
                )
              )
            ])
          : await request) as Awaited<ReturnType<typeof ai.generate>>;
        clearQuotaCooldown();
      } catch (error) {
        blockQuota(error);
        throw error;
      }
      if (outputSchema) {
        const limitedOutput = applyOutputCharLimit(res.output as TOutput);
        const validated = outputSchema.safeParse(limitedOutput);
        if (!validated.success) {
          return err(
            makeAiError(
              'AI_SCHEMA_INVALID',
              'AI response validation failed.',
              validated.error.message,
              true
            )
          );
        }
        return ok(validated.data);
      }
      const text = res?.text;
      if (!text || typeof text !== 'string') {
        return err(
          makeAiError(
            'AI_BAD_RESPONSE',
            'AI returned an empty response.',
            'gemini-empty-response',
            true
          )
        );
      }
      return ok(applyOutputCharLimit(text.trim()));
    }

    if (provider === 'openrouter') {
      const content = await callOpenRouterChat({
        messages: cappedMessages,
        temperature,
        responseFormat: effectiveResponseFormat,
        modelOverride,
        timeoutMs: timeoutValue,
      });
      if (outputSchema) {
        const parsed = safeJsonParse<unknown>(content);
        if (!parsed.ok) return err(parsed.error);
        const validated = outputSchema.safeParse(parsed.data);
        if (!validated.success) {
          return err(
            makeAiError(
              'AI_SCHEMA_INVALID',
              'AI response validation failed.',
              validated.error.message,
              true
            )
          );
        }
        const limitedOutput = applyOutputCharLimit(validated.data);
        const limitedValidated = outputSchema.safeParse(limitedOutput);
        if (!limitedValidated.success) {
          return err(
            makeAiError(
              'AI_SCHEMA_INVALID',
              'AI response validation failed.',
              limitedValidated.error.message,
              true
            )
          );
        }
        return ok(limitedValidated.data);
      }
      return ok(applyOutputCharLimit(content));
    }

    const content = await callOpenAIChat({
      messages: cappedMessages,
      temperature,
      responseFormat: effectiveResponseFormat,
      modelOverride,
      timeoutMs: timeoutValue,
    });
    if (outputSchema) {
      const parsed = safeJsonParse<unknown>(content);
      if (!parsed.ok) return err(parsed.error);
      const validated = outputSchema.safeParse(parsed.data);
      if (!validated.success) {
        return err(
          makeAiError(
            'AI_SCHEMA_INVALID',
            'AI response validation failed.',
            validated.error.message,
            true
          )
        );
      }
      const limitedOutput = applyOutputCharLimit(validated.data);
      const limitedValidated = outputSchema.safeParse(limitedOutput);
      if (!limitedValidated.success) {
        return err(
          makeAiError(
            'AI_SCHEMA_INVALID',
            'AI response validation failed.',
            limitedValidated.error.message,
            true
          )
        );
      }
      return ok(limitedValidated.data);
    }
    return ok(applyOutputCharLimit(content));
  };

  const promise = run()
    .then(result => {
      if (result.ok) {
        recordCircuitSuccess();
        return result;
      }
      recordCircuitFailure(result.error.code);
      captureException(result.error, { provider, model: effectiveModelName });
      return result;
    })
    .catch(error => {
      const mapped = mapAiError(error);
      recordCircuitFailure(mapped.code);
      captureException(error, { provider, model: effectiveModelName });
      return err(mapped);
    })
    .finally(() => {
      inFlightMap.delete(inFlightKey);
    }) as Promise<Result<TOutput | string>>;
  inFlightMap.set(inFlightKey, promise);
  return promise;
}
