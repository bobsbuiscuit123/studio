'use server';

import { runWithAiAction } from '@/ai/ai-action-context';
import { MAX_ASSISTANT_PROMPT_CHARS, clampAssistantPrompt } from '@/ai/flows/assistant-prompt-limit';
import { err, ok, type Result } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { headers, cookies } from 'next/headers';
import { z } from 'zod';

const AI_CONSUME_TIMEOUT_MS = 20_000;

const resolveOrigin = async () => {
  const headerList = await headers();
  return (
    headerList.get('origin') ||
    `${headerList.get('x-forwarded-proto') || 'http'}://${headerList.get('x-forwarded-host') || 'localhost:3000'}`
  );
};

const getSelectedOrgId = async () => {
  const cookieStore = await cookies();
  return cookieStore.get('selectedOrgId')?.value ?? null;
};

const callAiConsume = async <T>(
  feature: 'chat' | 'insights' | 'whats_new',
  action: string,
  payload: unknown
): Promise<Result<T>> => {
  const origin = await resolveOrigin();
  const headerList = await headers();
  const cookieHeader = headerList.get('cookie') ?? '';
  const orgId = await getSelectedOrgId();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_CONSUME_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${origin}/api/ai/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ orgId, feature, action, payload }),
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
  if (!json || typeof json !== 'object' || !('ok' in json)) {
    return err({
      code: 'NETWORK_HTTP_ERROR',
      message: 'Invalid server response.',
      source: 'network',
    });
  }
  return json as Result<T>;
};

export async function planTasksAction(query: string, context?: string) {
  return runWithAiAction('planTasksAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-plan:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z.string().min(2).safeParse(query);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: parsed.error.errors[0]?.message ?? 'Invalid query.',
        source: 'app',
      });
    }
    const trimmedContext = clampAssistantPrompt(
      context && context.length > MAX_ASSISTANT_PROMPT_CHARS
        ? context.slice(-MAX_ASSISTANT_PROMPT_CHARS)
        : context
    );
    return callAiConsume('chat', 'plan_tasks', {
      query: clampAssistantPrompt(query),
      context: trimmedContext,
    });
  });
}

export async function resolveFollowUpAnswersAction(
  questions: string[],
  reply: string
) {
  return runWithAiAction('resolveFollowUpAnswersAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-followups:${ip}`, 30, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z
      .object({
        questions: z.array(z.string().min(1)).min(1),
        reply: z.string().min(1),
      })
      .safeParse({ questions, reply });
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: 'Invalid follow-up response.',
        source: 'app',
      });
    }
    return callAiConsume('chat', 'followups', {
      questions,
      reply: clampAssistantPrompt(reply),
    });
  });
}

export async function runAssistantAction(query: string, context?: string) {
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
    const trimmedContext = clampAssistantPrompt(
      context && context.length > MAX_ASSISTANT_PROMPT_CHARS
        ? context.slice(-MAX_ASSISTANT_PROMPT_CHARS)
        : context
    );
    return callAiConsume('chat', 'assistant', {
      query: clampAssistantPrompt(query),
      context: trimmedContext,
    });
  });
}

export async function routeAssistantQuestionAction(query: string, context?: string) {
  return runWithAiAction('routeAssistantQuestionAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-question-router:${ip}`, 40, 60_000);
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
    const trimmedContext = clampAssistantPrompt(
      context && context.length > MAX_ASSISTANT_PROMPT_CHARS
        ? context.slice(-MAX_ASSISTANT_PROMPT_CHARS)
        : context
    );
    return callAiConsume('chat', 'assistant_question', {
      query: clampAssistantPrompt(query),
      context: trimmedContext,
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
type TaskType =
  | 'announcement'
  | 'form'
  | 'calendar'
  | 'email'
  | 'messages'
  | 'gallery'
  | 'transaction'
  | 'other';

export async function runTaskAction(
  type: TaskType,
  prompt: string
): Promise<Result<unknown>> {
  return runWithAiAction('runTaskAction', async () => {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    const limiter = rateLimit(`ai-task:${ip}`, 25, 60_000);
    if (!limiter.allowed) {
      return err({
        code: 'NETWORK_HTTP_ERROR',
        message: 'Too many requests. Please slow down.',
        source: 'network',
      });
    }
    const parsed = z
      .object({
        type: z.string().min(1),
        prompt: z.string().min(2),
      })
      .safeParse({ type, prompt });
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: 'Invalid task request.',
        source: 'app',
      });
    }
    switch (type) {
      case 'announcement':
        return callAiConsume('chat', 'announcement', { prompt: clampAssistantPrompt(prompt) });
      case 'form':
        return callAiConsume('chat', 'form', { prompt: clampAssistantPrompt(prompt) });
      case 'calendar':
        return callAiConsume('chat', 'calendar', { prompt: clampAssistantPrompt(prompt) });
      case 'email':
        return callAiConsume('chat', 'email', { prompt: clampAssistantPrompt(prompt) });
      case 'messages':
        return callAiConsume('chat', 'messages', { prompt: clampAssistantPrompt(prompt) });
      case 'gallery':
        return callAiConsume('chat', 'gallery', { prompt: clampAssistantPrompt(prompt) });
      case 'transaction':
        return callAiConsume('chat', 'transaction', { prompt: clampAssistantPrompt(prompt) });
      case 'other':
        return ok({
          message:
            "Sorry - I can't do that in this app yet. I can help with announcements, forms, calendar events, emails, messages, gallery uploads, and transactions.",
        });
      default:
        return err({
          code: 'VALIDATION',
          message: 'Task type not supported.',
          source: 'app',
        });
    }
  });
}




