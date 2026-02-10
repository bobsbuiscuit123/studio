'use server';

import { planAssistantTasks } from '@/ai/flows/assistant-planner';
import { generateClubAnnouncement } from '@/ai/flows/generate-announcement';
import { generateClubForm } from '@/ai/flows/generate-form';
import { resolveFollowUpAnswers } from '@/ai/flows/resolve-followups';
import { runAssistant } from '@/ai/flows/assistant';
import { generateMessage } from '@/ai/flows/generate-message';
import { generateGalleryDescription } from '@/ai/flows/generate-gallery-description';
import { addCalendarEvent } from '@/ai/flows/add-calendar-event';
import { generateEmail } from '@/ai/flows/generate-email';
import { addTransaction } from '@/ai/flows/add-transaction';
import { generateSocialMediaPost } from '@/ai/flows/generate-social-media-post';
import { resolveAnnouncementRecipients } from '@/ai/flows/resolve-announcement-recipients';
import { resolveInsightRequest } from '@/ai/flows/resolve-insight-request';
import { resolveMetricValue } from '@/ai/flows/resolve-metric-value';
import { resolveGraphRequest } from '@/ai/flows/resolve-graph-request';
import { resolveMissedActivity } from '@/ai/flows/resolve-missed-activity';
import { runWithAiAction } from '@/ai/ai-action-context';
import { err, ok, type Result } from '@/lib/result';
import { rateLimit } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { z } from 'zod';
import { enforceAiQuota } from '@/lib/ai-quota';

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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    const trimmedContext =
      context && context.length > 3000 ? context.slice(-3000) : context;
    return planAssistantTasks({ query, context: trimmedContext });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    return resolveFollowUpAnswers({ questions, reply });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    const trimmedContext =
      context && context.length > 3000 ? context.slice(-3000) : context;
    const content = trimmedContext
      ? `App context:\n${trimmedContext}\n\nUser: ${query}`
      : query;
    return runAssistant({ query: content });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    return resolveAnnouncementRecipients({ prompt, context });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    return resolveInsightRequest({ prompt, context });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    return resolveMetricValue({ prompt, context });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    return resolveGraphRequest({ prompt, context });
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    return resolveMissedActivity({ summary });
  });
}
type TaskType =
  | 'announcement'
  | 'form'
  | 'slides'
  | 'calendar'
  | 'email'
  | 'messages'
  | 'gallery'
  | 'transaction'
  | 'social'
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
    const quota = await enforceAiQuota();
    if (!quota.ok) return quota;
    switch (type) {
      case 'announcement':
        return generateClubAnnouncement({ prompt });
      case 'form':
        return generateClubForm({ prompt });
      case 'slides':
        return err({
          code: 'VALIDATION',
          message: 'Slides are currently disabled in the assistant.',
          source: 'app',
        });
      case 'calendar':
        return addCalendarEvent({ prompt });
      case 'email':
        return generateEmail({ prompt });
      case 'messages':
        return generateMessage({ prompt });
      case 'gallery':
        return generateGalleryDescription({ prompt });
      case 'transaction':
        return addTransaction({ prompt });
      case 'social':
        return generateSocialMediaPost({ prompt });
      case 'other':
        return ok({
          message:
            "Sorry - I can't do that in this app yet. I can help with announcements, forms, calendar events, emails, messages, gallery uploads, transactions, and social posts.",
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




