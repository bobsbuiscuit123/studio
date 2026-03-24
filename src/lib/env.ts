import { z } from 'zod';

let validated = false;

const baseSchema = z.object({
  NODE_ENV: z.string().optional(),
  NEXT_PUBLIC_APP_ENV: z.string().optional(),
  AI_PROVIDER: z.string().optional(),
  AI_ENABLED: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  NEXT_PUBLIC_REVENUECAT_APPLE_API_KEY: z.string().optional(),
  REVENUECAT_WEBHOOK_AUTH: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
});

export const validateServerEnv = () => {
  if (validated) return;
  if (typeof window !== 'undefined') return;

  const env = baseSchema.parse(process.env);
  const isProd = env.NODE_ENV === 'production';
  if (!isProd) {
    validated = true;
    return;
  }

  const aiEnabled = env.AI_ENABLED !== 'false';
  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();

  if (aiEnabled) {
    if (provider === 'gemini' && !env.GEMINI_API_KEY) {
      throw new Error('Missing GEMINI_API_KEY for production AI.');
    }
    if (provider === 'openai' && !env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY for production AI.');
    }
    if (provider === 'openrouter' && !env.OPENROUTER_API_KEY) {
      throw new Error('Missing OPENROUTER_API_KEY for production AI.');
    }
  }

  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Missing Firebase Admin env vars for production push notifications.');
  }

  validated = true;
};
