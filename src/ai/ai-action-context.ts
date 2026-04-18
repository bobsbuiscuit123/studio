import { AsyncLocalStorage } from 'node:async_hooks';

type AiActionContext = {
  id: string;
  name: string;
  aiRequests: number;
  maxAiRequests: number;
  startedAt: number;
};

const aiActionStorage = new AsyncLocalStorage<AiActionContext>();
const isDebugLoggingEnabled = process.env.NODE_ENV !== 'production';
const DEFAULT_MAX_AI_REQUESTS_PER_ACTION = (() => {
  const parsed = Number.parseInt(
    String(process.env.AI_MAX_CALLS_PER_ACTION ?? '').trim(),
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
})();

export function runWithAiAction<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const context: AiActionContext = {
    id,
    name,
    aiRequests: 0,
    maxAiRequests: DEFAULT_MAX_AI_REQUESTS_PER_ACTION,
    startedAt: Date.now(),
  };

  return aiActionStorage.run(context, async () => {
    try {
      return await fn();
    } finally {
      const elapsedMs = Date.now() - context.startedAt;
      if (isDebugLoggingEnabled) {
        console.info(
          `[AI_DEBUG] AI requests total=${context.aiRequests} | action=${context.name} | actionId=${context.id} | elapsedMs=${elapsedMs}`
        );
      }
    }
  });
}

export function recordAiActionRequest(
  providerName: string,
  modelName: string,
  keyPresent?: boolean
) {
  const context = aiActionStorage.getStore();
  if (context) {
    if (context.aiRequests >= context.maxAiRequests) {
      throw new Error(
        `AI safety limit reached for action ${context.name}. maxCallsPerAction=${context.maxAiRequests}`
      );
    }

    context.aiRequests += 1;
    if (isDebugLoggingEnabled) {
      console.info(
        `[AI_DEBUG] AI request #${context.aiRequests} | action=${context.name} | actionId=${context.id} | provider=${providerName} | model=${modelName} | key_present=${Boolean(keyPresent)}`
      );
    }
    return;
  }

  if (isDebugLoggingEnabled) {
    console.info(
      `[AI_DEBUG] AI request (no action) | provider=${providerName} | model=${modelName} | key_present=${Boolean(keyPresent)}`
    );
  }
}

export function recordGeminiRequest(modelName: string, keyPresent: boolean) {
  recordAiActionRequest('gemini', modelName, keyPresent);
}
