import { AsyncLocalStorage } from 'node:async_hooks';

type AiActionContext = {
  id: string;
  name: string;
  geminiRequests: number;
  startedAt: number;
};

const aiActionStorage = new AsyncLocalStorage<AiActionContext>();

export function runWithAiAction<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const context: AiActionContext = {
    id,
    name,
    geminiRequests: 0,
    startedAt: Date.now(),
  };

  return aiActionStorage.run(context, async () => {
    try {
      return await fn();
    } finally {
      const elapsedMs = Date.now() - context.startedAt;
      console.info(
        `[AI_DEBUG] Gemini requests total=${context.geminiRequests} | action=${context.name} | actionId=${context.id} | elapsedMs=${elapsedMs}`
      );
    }
  });
}

export function recordGeminiRequest(modelName: string, keyPresent: boolean) {
  const context = aiActionStorage.getStore();
  if (context) {
    context.geminiRequests += 1;
    console.info(
      `[AI_DEBUG] Gemini request #${context.geminiRequests} | action=${context.name} | actionId=${context.id} | model=${modelName} | key_present=${keyPresent}`
    );
    return;
  }

  console.info(
    `[AI_DEBUG] Gemini request (no action) | model=${modelName} | key_present=${keyPresent}`
  );
}
