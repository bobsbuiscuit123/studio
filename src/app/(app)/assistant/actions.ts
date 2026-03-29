'use server';

import { runWithAiAction } from '@/ai/ai-action-context';
import { runAssistant } from '@/ai/flows/assistant';
import { MAX_ASSISTANT_PROMPT_CHARS, clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { err, type Result } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { z } from 'zod';

const AI_CONSUME_TIMEOUT_MS = 20_000;

const resolveInternalApiUrl = async (pathname: string) => {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || 'localhost:3000';
  const forwardedProto = headerList.get('x-forwarded-proto');
  const protocol =
    host.includes('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : forwardedProto || 'https';
  return `${protocol}://${host}${pathname}`;
};

export type AssistantHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

export type AssistantActionResult = {
  tool: string;
  input: Record<string, unknown>;
  status: 'completed' | 'failed';
  output?: unknown;
  error?: string;
};

export type AssistantResponse = {
  reply: string;
  needsFollowup: boolean;
  followupQuestion: string | null;
  actions: AssistantActionResult[];
};

const callAiConsume = async <T>(
  feature: 'chat' | 'insights' | 'whats_new',
  action: string,
  payload: unknown
): Promise<Result<T>> => {
  const url = await resolveInternalApiUrl('/api/ai/consume');
  const headerList = await headers();
  const cookieHeader = headerList.get('cookie') ?? '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_CONSUME_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({ feature, action, payload }),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: string }).name)
        : '';
    return err({
      code: message === 'AbortError' ? 'NETWORK_TIMEOUT' : 'NETWORK_HTTP_ERROR',
      message:
        message === 'AbortError'
          ? 'AI request timed out. Please try again.'
          : 'Network request failed. Please try again.',
      source: 'network',
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    return err({
      code: 'NETWORK_HTTP_ERROR',
      message: 'Invalid server response.',
      source: 'network',
    });
  }
  if ('ok' in json) {
    return json as Result<T>;
  }
  if ('success' in json && json.success === true) {
    return { ok: true, data: (json as { data: T }).data };
  }
  if ('error' in json && (json as { error?: unknown }).error) {
    return err({
      code: 'NETWORK_HTTP_ERROR',
      message:
        typeof (json as { message?: unknown }).message === 'string'
          ? (json as { message: string }).message
          : 'Request failed.',
      source: 'network',
    });
  }
  return err({
    code: 'NETWORK_HTTP_ERROR',
    message: 'Invalid server response.',
    source: 'network',
  });
};

export async function runAssistantAction(
  query: string,
  history?: AssistantHistoryItem[]
) {
  return runWithAiAction('runAssistantAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-chat:${ip}`, 40, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(1).safeParse(query);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid query.',
        source: 'app',
      });
    }
    const normalizedQuery = clampAssistantPrompt(query).trim();
    if (!normalizedQuery) {
      return err({
        code: 'VALIDATION',
        message: 'Message cannot be empty.',
        source: 'app',
      });
    }
    const trimmedHistory = Array.isArray(history)
      ? history
          .slice(-3)
          .map(item => ({
            role: item.role,
            content: clampAssistantPrompt(item.content).slice(-MAX_ASSISTANT_PROMPT_CHARS),
          }))
      : undefined;
    return runAssistant({
      query: normalizedQuery,
      history: trimmedHistory,
      orgId: '00000000-0000-0000-0000-000000000000',
      groupId: null,
      userId: '00000000-0000-0000-0000-000000000000',
    });
  });
}

export async function resolveAnnouncementRecipientsAction(
  prompt: string,
  context?: string
) {
  return runWithAiAction('resolveAnnouncementRecipientsAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-announcement-recipients:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(2).safeParse(prompt);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid prompt.',
        source: 'app',
      });
    }
    return callAiConsume('chat', 'announcement_recipients', {
      prompt: clampAssistantPrompt(prompt),
      context: clampAssistantPrompt(context),
    });
  });
}

export async function resolveInsightRequestAction(prompt: string, context?: string) {
  return runWithAiAction('resolveInsightRequestAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-insight:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(2).safeParse(prompt);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid prompt.',
        source: 'app',
      });
    }
    return callAiConsume('insights', 'resolve_insight_request', {
      prompt: clampAssistantPrompt(prompt),
      context: clampAssistantPrompt(context),
    });
  });
}

export async function resolveMetricValueAction(prompt: string, context?: string) {
  return runWithAiAction('resolveMetricValueAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-metric:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(2).safeParse(prompt);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid prompt.',
        source: 'app',
      });
    }
    return callAiConsume('chat', 'metric', {
      prompt: clampAssistantPrompt(prompt),
      context: clampAssistantPrompt(context),
    });
  });
}

export async function resolveGraphRequestAction(prompt: string, context?: string) {
  return runWithAiAction('resolveGraphRequestAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-graph:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(2).safeParse(prompt);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid prompt.',
        source: 'app',
      });
    }
    return callAiConsume('chat', 'graph', {
      prompt: clampAssistantPrompt(prompt),
      context: clampAssistantPrompt(context),
    });
  });
}

export async function resolveMissedActivityAction(summary: string) {
  return runWithAiAction('resolveMissedActivityAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-missed:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(2).safeParse(summary);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid summary.',
        source: 'app',
      });
    }
    return callAiConsume('chat', 'missed_activity', {
      summary: clampAssistantPrompt(summary),
    });
  });
}




