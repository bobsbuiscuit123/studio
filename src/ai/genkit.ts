import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

const apiKey =
  process.env.GEMINI_API_KEY ??
  process.env.GOOGLE_GENAI_API_KEY ??
  process.env.GOOGLE_API_KEY;

if (!apiKey) {
  throw new Error(
    'Missing Gemini API key. Set GEMINI_API_KEY (or GOOGLE_GENAI_API_KEY / GOOGLE_API_KEY) in .env.local.'
  );
}

// Allow overriding the model via env, default to a widely available model.
const MODEL_NAME = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
const defaultModel = googleAI.model(MODEL_NAME);

export const ai = genkit({
  plugins: [googleAI({apiKey})],
  model: defaultModel,
});

// Temporary logging helper to verify env availability at call time.
export function logAiEnvDebug(callSite: string) {
  const key =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_GENAI_API_KEY ??
    process.env.GOOGLE_API_KEY;
  console.info(
    `[AI_DEBUG] ${callSite} | key_present=${!!key} | key_prefix=${
      key ? key.slice(0, 6) : 'none'
    } | model=${MODEL_NAME}`
  );
}
