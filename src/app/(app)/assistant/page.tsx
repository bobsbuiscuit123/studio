
'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { useForm } from 'react-hook-form';

import { zodResolver } from '@hookform/resolvers/zod';

import * as z from 'zod';

import {

  Send,
  Loader2,
  Bot,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  RefreshCw,
  X,

} from 'lucide-react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';



import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';

import { Textarea } from '@/components/ui/textarea';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { ToastAction } from '@/components/ui/toast';

import { useToast } from '@/hooks/use-toast';

import {
  useAnnouncements,
  useCurrentUser,
  useCurrentUserRole,
  useEvents,
  useForms,
  useGalleryImages,
  useGroupChats,
  useMembers,
  useMessages,
  useTransactions,
  notifyOrgAiUsageChanged,
} from '@/lib/data-hooks';
import type { Attachment, ClubForm, FormQuestion, GalleryImage } from '@/lib/mock-data';
import type { Result } from '@/lib/result';
import { safeFetchJson } from '@/lib/network';
import { getSelectedOrgId } from '@/lib/selection';
import {
  planTasksAction,
  runAssistantAction,
  runTaskAction,
} from './actions';
import {
  clearAssistantPrefill,
  getAssistantPrefill,
} from '@/lib/assistant/prefill';
import { useGroupUserStateSection } from '@/lib/group-user-state';


type TaskType =
  | 'announcement'
  | 'form'
  | 'calendar'
  | 'email'
  | 'messages'
  | 'gallery'
  | 'transaction'
  | 'other';


type PendingAttachment = Attachment & {

  size: number;

  text?: string;

};

type FollowUpAnswer = {
  question: string;
  answer: string;
};

type FollowUpResolution = {
  answers: FollowUpAnswer[];
  missing: string[];
};

const supportedAssistantTaskTypes: TaskType[] = [
  'announcement',
  'form',
  'calendar',
  'email',
  'messages',
  'gallery',
  'transaction',
  'other',
];

const isSupportedAssistantTaskType = (value: unknown): value is TaskType =>
  typeof value === 'string' &&
  supportedAssistantTaskTypes.includes(value as TaskType);

type AssistantReplyPayload = {
  response: string;
};

type PlannerPayload = {
  tasks: PlannedTaskInput[];
  summary: string;
};

const getResultData = <T,>(
  result: Result<T>,
  onError?: (message: string, error?: Result<T> extends { ok: false; error: infer E } ? E : unknown) => void
): T | null => {
  if (result.ok) {
    notifyOrgAiUsageChanged(getSelectedOrgId(), 1);
    return result.data;
  }
  if (onError) onError(result.error.message, result.error);
  return null;
};

const aiFallbackMessage =
  'AI is unavailable right now. You can continue in manual mode.';



type PlannedTask = {
  id: string;
  type: TaskType;
  prompt: string;
  title?: string;
  followUpQuestions?: string[];
  recipients?: string[];
  clarification?: string;
  draft?: string;
  draftSource?: string;
  draftTyping?: { startedAt: number; fullText: string };
  draftingStartedAt?: number;
  draftError?: string;
  isDrafting?: boolean;
  lastSentDraft?: string;
  attachments?: PendingAttachment[];
  linkedFormId?: string;
  linkedFormTaskId?: string;
  autoDraftRequested?: boolean;
  status: 'pending' | 'sent' | 'error';
  result?: any;
  draftResult?: any;
  error?: string;
};

type PlannedTaskInput = Omit<PlannedTask, 'status'> & {
  status?: PlannedTask['status'];
};


type AssistantPlanMessage = {
  id: string;
  sender: 'assistant';
  plan: { summary: string; tasks: PlannedTask[]; startedAt?: number };
};

type AssistantTextMessage = {
  id: string;
  sender: 'assistant';
  text: string;
  startedAt?: number;
};

type AssistantFollowUpMessage = {
  id: string;
  sender: 'assistant';
  followUp: { questions: string[]; startedAt?: number };
};

type ChatMessage =
  | { id: string; sender: 'user'; text: string }
  | AssistantPlanMessage
  | AssistantTextMessage
  | AssistantFollowUpMessage;

type PendingPlan = {
  planId: string;
  summary: string;
  tasks: PlannedTask[];
  questions: string[];
  questionTaskMap: Record<string, string[]>;
  taskQuestionMap: Record<string, string[]>;
};

type DraftRegenerationRequest = {
  planId: string;
  task: PlannedTask;
} | null;

type RecentForm = {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
};

type AssistantStoredState = {
  history: ChatMessage[];
  recentForms: RecentForm[];
};

const sanitizePersistedAssistantHistory = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map(message => {
    if (!isPlanMessage(message)) return message;
    return {
      ...message,
      plan: {
        ...message.plan,
        tasks: message.plan.tasks.map(task => {
          const { attachments, ...rest } = task as PlannedTask;
          return rest;
        }),
      },
    };
  });

const buildPersistedAssistantState = (
  messages: ChatMessage[],
  recentForms: RecentForm[],
  recentFormsLimit: number
): AssistantStoredState => ({
  history: sanitizePersistedAssistantHistory(messages),
  recentForms: recentForms.slice(0, recentFormsLimit),
});

const stableSerializeAssistantState = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerializeAssistantState(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerializeAssistantState(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sanitizePlannedTask = (value: unknown): PlannedTask | null => {
  if (!isObjectRecord(value) || typeof value.id !== 'string') return null;
  if (!isSupportedAssistantTaskType(value.type)) return null;
  return {
    id: value.id,
    type: value.type,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    title: typeof value.title === 'string' ? value.title : undefined,
    followUpQuestions: Array.isArray(value.followUpQuestions)
      ? value.followUpQuestions.filter((item): item is string => typeof item === 'string')
      : undefined,
    recipients: Array.isArray(value.recipients)
      ? value.recipients.filter((item): item is string => typeof item === 'string')
      : undefined,
    clarification: typeof value.clarification === 'string' ? value.clarification : undefined,
    draft: typeof value.draft === 'string' ? value.draft : undefined,
    draftSource: typeof value.draftSource === 'string' ? value.draftSource : undefined,
    draftTyping:
      isObjectRecord(value.draftTyping) &&
      typeof value.draftTyping.startedAt === 'number' &&
      typeof value.draftTyping.fullText === 'string'
        ? {
            startedAt: value.draftTyping.startedAt,
            fullText: value.draftTyping.fullText,
          }
        : undefined,
    draftingStartedAt:
      typeof value.draftingStartedAt === 'number' ? value.draftingStartedAt : undefined,
    draftError: typeof value.draftError === 'string' ? value.draftError : undefined,
    isDrafting: typeof value.isDrafting === 'boolean' ? value.isDrafting : undefined,
    lastSentDraft: typeof value.lastSentDraft === 'string' ? value.lastSentDraft : undefined,
    attachments: Array.isArray(value.attachments)
      ? (value.attachments as PendingAttachment[])
      : undefined,
    linkedFormId: typeof value.linkedFormId === 'string' ? value.linkedFormId : undefined,
    linkedFormTaskId:
      typeof value.linkedFormTaskId === 'string' ? value.linkedFormTaskId : undefined,
    autoDraftRequested:
      typeof value.autoDraftRequested === 'boolean' ? value.autoDraftRequested : true,
    status:
      value.status === 'sent' || value.status === 'error' || value.status === 'pending'
        ? value.status
        : 'pending',
    result: value.result,
    draftResult: value.draftResult,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
};

const sanitizeChatMessage = (value: unknown): ChatMessage | null => {
  if (!isObjectRecord(value) || typeof value.id !== 'string' || typeof value.sender !== 'string') {
    return null;
  }

  if (value.sender === 'user') {
    return typeof value.text === 'string'
      ? { id: value.id, sender: 'user', text: value.text }
      : null;
  }

  if (value.sender !== 'assistant') return null;

  if (typeof value.text === 'string') {
    return {
      id: value.id,
      sender: 'assistant',
      text: value.text,
      startedAt: typeof value.startedAt === 'number' ? value.startedAt : undefined,
    };
  }

  if (isObjectRecord(value.followUp) && Array.isArray(value.followUp.questions)) {
    return {
      id: value.id,
      sender: 'assistant',
      followUp: {
        questions: value.followUp.questions.filter((item): item is string => typeof item === 'string'),
        startedAt:
          typeof value.followUp.startedAt === 'number' ? value.followUp.startedAt : undefined,
      },
    };
  }

  if (isObjectRecord(value.plan)) {
    const tasks = Array.isArray(value.plan.tasks)
      ? value.plan.tasks
          .map(sanitizePlannedTask)
          .filter((item): item is PlannedTask => Boolean(item))
      : [];
    return {
      id: value.id,
      sender: 'assistant',
      plan: {
        summary: typeof value.plan.summary === 'string' ? value.plan.summary : '',
        tasks,
        startedAt: typeof value.plan.startedAt === 'number' ? value.plan.startedAt : undefined,
      },
    };
  }

  return null;
};

const sanitizeRecentForms = (value: unknown, limit: number): RecentForm[] =>
  Array.isArray(value)
    ? value
        .filter(isObjectRecord)
        .map(item => ({
          id: typeof item.id === 'string' ? item.id : '',
          title: typeof item.title === 'string' ? item.title : 'Untitled form',
          description: typeof item.description === 'string' ? item.description : undefined,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }))
        .filter(item => item.id)
        .slice(0, limit)
    : [];

const isPlanMessage = (message: ChatMessage): message is AssistantPlanMessage =>
  message.sender === 'assistant' && 'plan' in message;

const isFollowUpMessage = (
  message: ChatMessage
): message is AssistantFollowUpMessage =>
  message.sender === 'assistant' && 'followUp' in message;

const isAssistantTextMessage = (
  message: ChatMessage
): message is AssistantTextMessage =>
  message.sender === 'assistant' && 'text' in message;

const buildAnswerDetails = (
  answers: Record<string, string> | undefined,
  questions: FormQuestion[]
) => {
  const output: Record<
    string,
    { value: string; attachmentDataUri?: string; attachmentType?: string }
  > = {};
  const answerEntries = answers ?? {};
  questions.forEach(question => {
    const raw = answerEntries[question.id];
    if (!raw) return;
    if (typeof raw === 'string' && raw.startsWith('data:')) {
      const type = raw.slice(5, raw.indexOf(';')) || 'file';
      output[question.id] = {
        value: 'Attachment provided',
        attachmentDataUri: raw,
        attachmentType: type,
      };
      return;
    }
    output[question.id] = { value: raw };
  });
  return output;
};

const formSchema = z.object({
  query: z
    .string()
    .min(1, 'Please enter a message.')
    .refine(value => value.trim().length > 0, 'Message cannot be empty.'),
});


const WORD_RE = /\s+/g;
const countWords = (text: string) => text.trim().split(WORD_RE).filter(Boolean).length;
const AI_SPARKLE =
  'bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]';

const FOLLOWUP_HEADER_TEXT = 'I need a few details before I can draft this:';


const typewriterChars = ({

  text,

  startAt,

  now,

  charDelayMs,

}: {

  text: string;

  startAt?: number;

  now: number;

  charDelayMs: number;

}) => {

  const startedAt = startAt ?? 0;

  if (!startedAt) return text;

  if (now < startedAt) return '';

  const elapsed = Math.max(0, now - startedAt);

  const visibleCount = Math.min(text.length, Math.floor(elapsed / charDelayMs) + 1);

  return text.slice(0, visibleCount);

};



const getMessageAnimationTimings = ({
  startedAt,
  summary,
}: {
  startedAt?: number;
  summary: string;
}) => {
  const base = startedAt ?? 0;
  if (!base) {
    return {
      summaryStartAt: undefined,
      tasksStartAt: undefined,
    };
  }
  const summaryStartAt = base;
  const summaryDurationMs = countWords(summary) * 35 + 350;
  const tasksStartAt = summaryStartAt + summaryDurationMs;
  return {
    summaryStartAt,
    tasksStartAt,
  };
};


const getTaskAnimationTimings = ({
  tasksStartAt,
  index,
  taskTitleText,
  question,

  hasFollowUp,

}: {

  tasksStartAt?: number;

  index: number;

  taskTitleText: string;

  question: string;

  hasFollowUp: boolean;

}) => {

  const taskBaseStartAt = tasksStartAt ? tasksStartAt + index * 200 : undefined;

  const taskTitleDurationMs = countWords(taskTitleText) * 40 + 150;

  const followUpStartAt = taskBaseStartAt ? taskBaseStartAt + taskTitleDurationMs : undefined;

  const followUpDurationMs = countWords(question) * 35 + 150;

  const draftSectionStartAt = followUpStartAt

    ? followUpStartAt + (hasFollowUp ? followUpDurationMs + 150 : 150)

    : undefined;

  return {
    taskBaseStartAt,
    followUpStartAt,
    followUpDurationMs,
    draftSectionStartAt,
  };
};

const getTaskTitleText = (taskType: TaskType) => {
  if (taskType === 'form') return 'Edit Form Details';
  if (taskType === 'messages') return 'Message task';
  if (taskType === 'gallery') return 'Gallery task';
  return `${taskType} task`;
};


function TypewriterText({

  text,

  startAt,

  now,

  className,

  wordDelayMs = 60,

}: {

  text: string;

  startAt?: number;

  now: number;

  className?: string;

  wordDelayMs?: number;

}) {

  const startedAt = startAt ?? 0;

  if (!startedAt) return <span className={className}>{text}</span>;

  if (now < startedAt) return <span className={className} />;



  const words = text.trim().split(WORD_RE).filter(Boolean);

  if (words.length === 0) return <span className={className} />;



  const elapsed = Math.max(0, now - startedAt);

  const visibleCount = Math.min(words.length, Math.floor(elapsed / wordDelayMs) + 1);

  const rendered = words.slice(0, visibleCount).join(' ');

  return <span className={className}>{rendered}</span>;

}



function AssistantPageInner() {

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [showAddPeople, setShowAddPeople] = useState<Record<string, boolean>>({});
  const [recentForms, setRecentForms] = useState<RecentForm[]>([]);
  const [formTaskIdMap, setFormTaskIdMap] = useState<Record<string, string>>({});
  const [aiBlockedReason, setAiBlockedReason] = useState<'limit' | 'billing' | null>(null);
  const [draftRegenerationRequest, setDraftRegenerationRequest] =
    useState<DraftRegenerationRequest>(null);
  const { toast } = useToast();
  const lastAssistantPersistedRef = useRef('');
  const draftGenerationInFlightRef = useRef<Set<string>>(new Set());

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const stickToBottomRef = useRef(true);

  const didInitialScrollRef = useRef(false);

  const activeAutoscrollMessageIdRef = useRef<string | null>(null);

  const autoscrollDisabledForMessageRef = useRef<Set<string>>(new Set());

  const lastAutoScrollAtRef = useRef(0);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { user } = useCurrentUser();
  const { canManageRoles } = useCurrentUserRole();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemoAssistantRoute =
    pathname === '/demo/app/assistant' || pathname.startsWith('/demo/app/assistant/');
  const appBrandName = isDemoAssistantRoute ? 'CASPO' : 'CASPO';
  const didApplyPrefillRef = useRef(false);
  const announcements = useAnnouncements();
  const forms = useForms();
  const events = useEvents();
  const galleryImages = useGalleryImages();
  const messagesData = useMessages();
  const groupChats = useGroupChats();

  const handleAiError = (
    message: string,
    error?: unknown
  ) => {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === 'DAILY_LIMIT_REACHED') {
      setAiBlockedReason('limit');
      toast({
        title: 'Daily limit reached',
        description: 'Your AI credits are used up for today.',
        variant: 'destructive',
      });
      return;
    }
    if (code === 'BILLING_INACTIVE') {
      setAiBlockedReason('billing');
      toast({
        title: 'Billing issue',
        description: 'Ask an admin to update the subscription.',
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'AI unavailable',
      description: message,
      variant: 'destructive',
    });
  };

  useEffect(() => {
    const orgId = getSelectedOrgId();
    if (!orgId) return;
    let cancelled = false;
    const loadStatus = async () => {
      const statusResult = await safeFetchJson<{ ok: true; data: { status: string; creditsUsedToday: number; dailyCreditPerUser: number } }>(
        `/api/orgs/${orgId}/status`,
        { method: 'GET' }
      );
      if (cancelled || !statusResult.ok) return;
      const statusData = statusResult.data.data;
      const status = statusData.status;
      const isActive = status === 'active' || status === 'trialing';
      if (!isActive) {
        setAiBlockedReason('billing');
        return;
      }
      if (statusData.creditsUsedToday >= statusData.dailyCreditPerUser) {
        setAiBlockedReason('limit');
        return;
      }
      setAiBlockedReason(null);
    };
    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  const members = useMembers();
  const transactions = useTransactions();


  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { query: '' },
  });

  useEffect(() => {
    if (didApplyPrefillRef.current) return;
    const existing = form.getValues('query')?.trim();
    if (existing) {
      didApplyPrefillRef.current = true;
      return;
    }
    const prefill = getAssistantPrefill(searchParams);
    if (!prefill) return;
    form.setValue('query', prefill, { shouldDirty: true });
    didApplyPrefillRef.current = true;
    clearAssistantPrefill();
  }, [form, searchParams]);

  const {
    data: assistantState,
    updateData: updateAssistantState,
    loading: assistantStateLoading,
    orgId: assistantOrgId,
    groupId: assistantGroupId,
  } =
    useGroupUserStateSection<AssistantStoredState>('assistant', {
      history: [],
      recentForms: [],
    });
  const RECENT_MESSAGES_LIMIT = 3;
  const RECENT_FORMS_LIMIT = 3;


  const MAX_ATTACHMENTS = 5;

  const MAX_ATTACHMENT_SIZE_BYTES = 1_000_000; // localStorage-friendly (~1MB)



  const getScrollViewport = () => {

    const root = scrollAreaRef.current;

    if (!root) return null;

    return root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;

  };



  const formatBytes = (bytes: number) => {

    if (!Number.isFinite(bytes)) return '';

    if (bytes < 1024) return `${bytes} B`;

    const kb = bytes / 1024;

    if (kb < 1024) return `${kb.toFixed(1)} KB`;

    const mb = kb / 1024;

    return `${mb.toFixed(1)} MB`;

  };



  const isTextLikeFile = (file: File) => {

    if (file.type.startsWith('text/')) return true;

    const name = file.name.toLowerCase();

    return (

      name.endsWith('.txt') ||

      name.endsWith('.md') ||

      name.endsWith('.csv') ||

      name.endsWith('.json') ||

      name.endsWith('.log')

    );

  };



  const readFileAsDataURL = (file: File) =>

    new Promise<string>((resolve, reject) => {

      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Failed to read file.'));

      reader.onload = () => resolve(String(reader.result ?? ''));

      reader.readAsDataURL(file);

    });



  const readFileAsText = (file: File) =>

    new Promise<string>((resolve, reject) => {

      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Failed to read file text.'));

      reader.onload = () => resolve(String(reader.result ?? ''));

      reader.readAsText(file);

    });



  const buildAttachmentContextForAI = (attachments: PendingAttachment[] | undefined) => {
    const list = Array.isArray(attachments) ? attachments : [];
    if (list.length === 0) return null;


    const lines: string[] = ['Attached files (use these if relevant):'];

    let remainingChars = 6000;



    list.forEach((att, idx) => {

      const label = `${idx + 1}) ${att.name}${att.type ? ` (${att.type})` : ''}${

        att.size ? ` - ${formatBytes(att.size)}` : ''

      }`;

      lines.push(label);



      const text = (att.text ?? '').trim();

      if (!text) return;



      if (remainingChars <= 0) return;

      const excerpt = text.slice(0, Math.min(text.length, 2000, remainingChars));

      remainingChars -= excerpt.length;

      lines.push('Text excerpt:');

      lines.push(excerpt);

    });



    return lines.join('\n');
  };

  const buildRecentContextForPlanner = () => {
    const roleLine = canManageRoles
      ? 'User role: officer/admin. All task types allowed.'
      : 'User role: member. Allowed tasks: messages and gallery only. Use chat responses for other requests.';
    const recentMessages = messages.slice(-RECENT_MESSAGES_LIMIT);
    const messageLines = recentMessages
      .map(msg => {
        if (msg.sender === 'user') return `User: ${msg.text}`;
        if (isAssistantTextMessage(msg)) return `Assistant: ${msg.text}`;
        if (isPlanMessage(msg)) {
          const taskTypes = msg.plan.tasks.map(task => task.type).join(', ');
          return `Assistant plan: ${msg.plan.summary}${taskTypes ? ` (tasks: ${taskTypes})` : ''}`;
        }
        if (isFollowUpMessage(msg)) {
          return `Assistant follow-up: ${msg.followUp.questions.join('; ')}`;
        }
        return '';
      })
      .filter(Boolean);

    const recentFormLines =
      recentForms.length > 0
        ? [
            'Recent forms created in this chat:',
            ...recentForms.map(form => {
              const description = form.description ? ` - ${form.description}` : '';
              return `- ${form.title}${description}`;
            }),
          ]
        : [];

    const blocks = [
      roleLine,
      messageLines.join('\n'),
      recentFormLines.join('\n'),
    ].filter(Boolean);
    return blocks.length > 0 ? blocks.join('\n\n') : undefined;
  };

const buildFastPlan = (
  query: string,
  attachments: PendingAttachment[]
): { tasks: PlannedTask[]; summary: string } | null => {
    const text = query.trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    const hasAttachment = attachments.length > 0;

    const matchAny = (patterns: RegExp[]) => patterns.some(pattern => pattern.test(lower));

    const typeMatches: { type: TaskType; matched: boolean }[] = [
      {
        type: 'announcement',
        matched: matchAny([
          /\bannouncement\b/,
          /\bannounce\b/,
          /\bpost (an )?announcement\b/,
          /\bsend (an )?announcement\b/,
          /\bremind(?:er|ing)?\b/,
        ]),
      },
      { type: 'messages', matched: matchAny([/\bmessage\b/, /\btext\b/, /\bdm\b/, /\bchat\b/]) },
      { type: 'email', matched: matchAny([/\bemail\b/]) },
      {
        type: 'calendar',
        matched: matchAny([
          /\bcalendar\b/,
          /\bschedule\b/,
          /\badd (?:an )?event\b/,
          /\bcreate (?:an )?event\b/,
          /\bput (?:it|this) on (?:the )?calendar\b/,
        ]),
      },
      { type: 'form', matched: matchAny([/\bform\b/, /\bsurvey\b/]) },
      {
        type: 'gallery',
        matched: matchAny([/\bgallery\b/, /\bphoto\b/, /\bimage\b/, /\bupload\b/]),
      },
      {
        type: 'transaction',
        matched: matchAny([/\btransaction\b/, /\bexpense\b/, /\bpayment\b/, /\bcharge\b/]),
      },
    ];
    const matchedTypes = typeMatches.filter(item => item.matched).map(item => item.type);
    const uniqueMatchedTypes = Array.from(new Set(matchedTypes));
    if (uniqueMatchedTypes.length === 0) return null;
    if (uniqueMatchedTypes.length > 3) return null;

    const memberList = Array.isArray(members.data) ? members.data : [];
    const groupList = Array.isArray(groupChats.data) ? groupChats.data : [];
    const roleMentioned = /\b(admin|officer|member|president|vice president|treasurer|secretary)\b/.test(
      lower
    );
    const nameMatches = memberList
      .map(member => [member.name, member.email, member.role] as const)
      .some(([name, email, role]) => {
        const baseEmail = email?.split('@')[0] ?? '';
        return [name, email, baseEmail, role]
          .filter(Boolean)
          .some(value => lower.includes(String(value).toLowerCase()));
      });
    const groupMatches = groupList
      .map(chat => chat.name)
      .filter(Boolean)
      .some(name => lower.includes(name.toLowerCase()));
    const explicitRecipientMentioned =
      /\b(to|for|message|dm|text|send)\b/.test(lower) &&
      (nameMatches ||
        groupMatches ||
        roleMentioned ||
        /\b(all|everyone|everybody|whole group|entire group)\b/.test(lower) ||
        /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/.test(lower));
    const hasDate = matchAny([
      /\btomorrow\b/,
      /\btomorow\b/,
      /\btomorows\b/,
      /\btomorrow's\b/,
      /\btmr\b/,
      /\btmrw\b/,
      /\btonight\b/,
      /\btonite\b/,
      /\bnext\b/,
      /\bthis\s+(mon|tue|wed|thu|thur|fri|sat|sun)\w*\b/,
      /\b(mon|tue|wed|thu|thur|fri|sat|sun)\w*\b/,
      /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\b/,
    ]);
    const hasTime = matchAny([
      /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/,
      /\b(noon|midnight|morning|afternoon|evening)\b/,
    ]);
    const hasQuestions = matchAny([/\bquestion\b/, /\bquestions\b/, /\bask\b/, /\?/]);
    const hasAmount = matchAny([/\$?\d+(?:\.\d{2})?\b/]);

    const buildFollowUpsForType = (type: TaskType) => {
      const followUpQuestions: string[] = [];

      if (type === 'messages') {
        if (!explicitRecipientMentioned) {
          followUpQuestions.push('Who should receive the message?');
        }
      }

      if (type === 'calendar') {
        if (!hasDate) followUpQuestions.push('What is the event date?');
        if (!hasTime) followUpQuestions.push('What time is the event?');
        if (!/\b(it'?s|it is|called|named)\b/.test(lower) && !/\bhalloween social\b/.test(lower)) {
          followUpQuestions.push('What is the event about?');
        }
      }

      if (type === 'form') {
        if (!hasQuestions) {
          followUpQuestions.push(
            'Please list the questions you want in the form and any answer choices for multiple-choice questions.'
          );
        }
      }

      if (type === 'gallery' && !hasAttachment) {
        followUpQuestions.push('Please attach at least one image.');
      }

      if (type === 'transaction' && !hasAmount) {
        followUpQuestions.push('What is the amount?');
      }

      return followUpQuestions.length > 0 ? followUpQuestions : undefined;
    };

    return {
      tasks: uniqueMatchedTypes.map((type, index) => ({
          id: `fast-${Date.now()}-${index}`,
          type,
          prompt: text,
          followUpQuestions: buildFollowUpsForType(type),
          status: 'pending',
        })),
      summary:
        uniqueMatchedTypes.length > 1
          ? "Got it - I split that into separate tasks."
          : "Got it - here's a draft.",
    };
  };

  const isInsightQuery = (query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return false;
    const startsAsQuestion =
      normalized.endsWith('?') ||
      normalized.startsWith('how ') ||
      normalized.startsWith('what ') ||
      normalized.startsWith('which ') ||
      normalized.startsWith('who ') ||
      normalized.startsWith('when ') ||
      normalized.startsWith('where ') ||
      normalized.startsWith('show ') ||
      normalized.startsWith('list ') ||
      normalized.startsWith('tell me ') ||
      normalized.startsWith('summarize ') ||
      normalized.startsWith('summarise ');
    const hasRetrievalTerms = /\b(latest|recent|summary|status|list|show|count|total|how many)\b/.test(
      normalized
    );
    const hasExecutionIntent = /\b(create|post|send|draft|add|schedule|make|generate|upload|publish|announce|compose|write|record|log)\b/.test(
      normalized
    );

    const hasFormMention = /\bform(s)?\b/.test(normalized);
    const hasResponseMention = /\brespond(ed|s|ing)?\b|\bresponse(s)?\b|\bsubmission(s)?\b/.test(
      normalized
    );
    const focusedFormInsight =
      hasFormMention &&
      hasResponseMention &&
      /\bhow many\b|\bnumber of\b|\bcount\b|\btotal\b|\blast\b|\blatest\b|\bmost recent\b/.test(
        normalized
      );

    if (focusedFormInsight) return true;
    if (!startsAsQuestion && !hasRetrievalTerms) return false;
    if (hasExecutionIntent && !focusedFormInsight) return false;
    return true;
  };

  const buildAppContextForAssistant = () => {
    const maxStringLength = 1200;
    const maxDepth = 7;

    const sanitize = (value: any, depth: number): any => {
      if (depth > maxDepth) return '[truncated]';
      if (value === null || value === undefined) return value;
      if (typeof value === 'string') {
        if (value.startsWith('data:')) return value;
        if (value.length <= maxStringLength) return value;
        return `${value.slice(0, maxStringLength)}...[truncated ${value.length} chars]`;
      }
      if (typeof value === 'number' || typeof value === 'boolean') return value;
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) {
        return value.map(item => sanitize(item, depth + 1));
      }
      if (typeof value === 'object') {
        const entries = Object.entries(value).map(([key, val]) => [
          key,
          sanitize(val, depth + 1),
        ]);
        return Object.fromEntries(entries);
      }
      return String(value);
    };

    const memberList = Array.isArray(members.data) ? members.data : [];
    const memberNameByEmail = new Map(
      memberList.map(member => [member.email, member.name])
    );

    const currentEmail = user?.email ?? '';
    const announcementsSnapshot = Array.isArray(announcements.data)
      ? announcements.data.map(item => ({
          id: item.id,
          title: item.title,
          content: item.content,
          author: item.author,
          date: item.date,
          attachments: item.attachments,
          linkedFormId: item.linkedFormId,
          ...(canManageRoles
            ? {
                viewedByNames: Array.isArray(item.viewedBy)
                  ? item.viewedBy.map(resolveMemberName)
                  : [],
                recipientNames: Array.isArray(item.recipients)
                  ? item.recipients.map(resolveMemberName)
                  : [],
              }
            : {}),
        }))
      : [];

    const formsSnapshot = Array.isArray(forms.data)
      ? forms.data.map(form => {
          const responses = Array.isArray(form.responses) ? form.responses : [];
          const memberResponses = currentEmail
            ? responses.filter(resp => resp.respondentEmail === currentEmail)
            : [];
          return {
            id: form.id,
            title: form.title,
            description: form.description,
            questions: form.questions,
            createdAt: form.createdAt,
            ...(canManageRoles
              ? {
                  viewedByNames: Array.isArray(form.viewedBy)
                    ? form.viewedBy.map(resolveMemberName)
                    : [],
                  responses: responses.map(response => ({
                    ...response,
                    respondentName: response.respondentEmail
                      ? resolveMemberName(response.respondentEmail)
                      : '',
                    answersDetailed: buildAnswerDetails(response.answers, form.questions),
                  })),
                }
              : {
                  responses: memberResponses.map(response => ({
                    ...response,
                    respondentName: response.respondentEmail
                      ? resolveMemberName(response.respondentEmail)
                      : '',
                    answersDetailed: buildAnswerDetails(response.answers, form.questions),
                  })),
                }),
          };
        })
      : [];

    const eventsSnapshot = Array.isArray(events.data)
      ? events.data.map(event => ({
          id: event.id,
          title: event.title,
          description: event.description,
          location: event.location,
          date: event.date,
          hasTime: event.hasTime,
          points: event.points,
          rsvpRequired: event.rsvpRequired,
          ...(canManageRoles ? { viewedBy: event.viewedBy, rsvps: event.rsvps } : {}),
        }))
      : [];

    const snapshot = {
      capabilities: canManageRoles
        ? {
            role: 'officer/admin',
            allowedTasks: [
              'announcement',
              'form',
              'calendar',
              'email',
              'messages',
              'gallery',
              'transaction',
            ],
          }
        : {
            role: 'member',
            allowedTasks: ['messages', 'gallery'],
          },
      currentUser: user ? { name: user.name, email: user.email } : undefined,
      members: memberList,
      announcements: announcementsSnapshot,
      forms: formsSnapshot,
      events: eventsSnapshot,
      transactions: canManageRoles ? transactions.data ?? [] : [],
      galleryImages: galleryImages.data ?? [],
      groupChats: groupChats.data ?? [],
      messages: messagesData.data ?? {},
    };

    return JSON.stringify(sanitize(snapshot, 0), null, 2);
  };

  const resolveMemberName = (value: string) => {
    const memberList = Array.isArray(members.data) ? members.data : [];
    const memberNameByEmail = new Map(
      memberList.map(member => [member.email, member.name])
    );
    const fromMembers = memberNameByEmail.get(value);
    if (fromMembers) return fromMembers;
    const emailMatch = value.match(/^([^@]+)@/);
    if (!emailMatch) return value;
    const base = emailMatch[1].replace(/[._-]+/g, ' ');
    return base
      .split(' ')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const isAssistantMessageAnimating = (message: AssistantPlanMessage) => {
    const startedAt = message.plan.startedAt ?? 0;
    if (!startedAt) return false;

    const { tasksStartAt } = getMessageAnimationTimings({
      startedAt,
      summary: message.plan.summary,
    });


    const baseEndAt = tasksStartAt

      ? tasksStartAt + message.plan.tasks.length * 200 + 600

      : startedAt + 1500;



    let endAt = baseEndAt;



    message.plan.tasks.forEach((task, index) => {

      if (task.isDrafting) {

        endAt = Math.max(endAt, now + 500);

        return;

      }



      if (!task.draftTyping) return;

      const taskTitleText = getTaskTitleText(task.type);
      const question = task.followUpQuestions?.length
        ? cleanFollowUp(task.followUpQuestions.join(' '))
        : '';
      const hasFollowUp = Boolean(task.followUpQuestions?.length);
      const { draftSectionStartAt } = getTaskAnimationTimings({

        tasksStartAt,

        index,

        taskTitleText,

        question,

        hasFollowUp,

      });



      const perCharMs = 14;

      const effectiveStartAt = draftSectionStartAt

        ? Math.max(task.draftTyping.startedAt, draftSectionStartAt)

        : task.draftTyping.startedAt;

      const totalMs = (task.draftTyping.fullText?.length ?? 0) * perCharMs + 300;

      endAt = Math.max(endAt, effectiveStartAt + totalMs);

    });



    return now < endAt;

  };



  useEffect(() => {
    if (assistantStateLoading || !assistantOrgId || !assistantGroupId) return;
    const nextHistory = Array.isArray(assistantState.history)
      ? assistantState.history
          .map(sanitizeChatMessage)
          .filter((item): item is ChatMessage => Boolean(item))
      : [];
    const nextRecentForms = sanitizeRecentForms(assistantState.recentForms, RECENT_FORMS_LIMIT);
    lastAssistantPersistedRef.current = stableSerializeAssistantState(
      buildPersistedAssistantState(nextHistory, nextRecentForms, RECENT_FORMS_LIMIT)
    );
    setMessages(prev =>
      stableSerializeAssistantState(prev) === stableSerializeAssistantState(nextHistory)
        ? prev
        : nextHistory
    );
    setRecentForms(prev =>
      stableSerializeAssistantState(prev) === stableSerializeAssistantState(nextRecentForms)
        ? prev
        : nextRecentForms
    );
    setHasLoadedHistory(true);
  }, [
    assistantGroupId,
    assistantOrgId,
    assistantState,
    assistantStateLoading,
    RECENT_FORMS_LIMIT,
  ]);

  useEffect(() => {
    if (!hasLoadedHistory) return;

    try {
      const nextPersistedState = buildPersistedAssistantState(
        messages,
        recentForms,
        RECENT_FORMS_LIMIT
      );
      const serializedNextState = stableSerializeAssistantState(nextPersistedState);
      if (serializedNextState === lastAssistantPersistedRef.current) {
        return;
      }
      lastAssistantPersistedRef.current = serializedNextState;
      void updateAssistantState(prev => ({
        ...prev,
        history: nextPersistedState.history,
        recentForms: nextPersistedState.recentForms,
      }));
    } catch (error) {
      console.error('Failed to persist assistant chat history', error);
    }
  }, [RECENT_FORMS_LIMIT, messages, recentForms, hasLoadedHistory, updateAssistantState]);


  useEffect(() => {

    const viewport = getScrollViewport();

    if (!viewport) return;



    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

    const isNearBottom = distanceFromBottom < 80;

    if (!stickToBottomRef.current || !isNearBottom) return;

    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });

  }, [messages]);



  useEffect(() => {

    const root = scrollAreaRef.current;

    if (!root) return;

    const viewport = root.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;

    if (!viewport) return;



    const updateStickiness = () => {

      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;

      stickToBottomRef.current = distanceFromBottom < 80;



      const activeId = activeAutoscrollMessageIdRef.current;

      if (!activeId) return;



      const isLikelyProgrammatic = Date.now() - lastAutoScrollAtRef.current < 120;

      if (isLikelyProgrammatic) return;



      if (distanceFromBottom > 120) {

        autoscrollDisabledForMessageRef.current.add(activeId);

      }

    };



    updateStickiness();

    viewport.addEventListener('scroll', updateStickiness, { passive: true });

    const onWheel = () => {

      const activeId = activeAutoscrollMessageIdRef.current;

      if (activeId) {

        autoscrollDisabledForMessageRef.current.add(activeId);

      }

    };

    const onPointerDown = () => {

      const activeId = activeAutoscrollMessageIdRef.current;

      if (activeId) {

        autoscrollDisabledForMessageRef.current.add(activeId);

      }

    };

    viewport.addEventListener('wheel', onWheel, { passive: true });

    viewport.addEventListener('pointerdown', onPointerDown, { passive: true });

    return () => {

      viewport.removeEventListener('scroll', updateStickiness);

      viewport.removeEventListener('wheel', onWheel);

      viewport.removeEventListener('pointerdown', onPointerDown);

    };

  }, [hasLoadedHistory]);



  useEffect(() => {

    if (!hasLoadedHistory) return;

    if (didInitialScrollRef.current) return;

    if (typeof window === 'undefined') return;



    didInitialScrollRef.current = true;

    stickToBottomRef.current = true;



    const doScroll = () => bottomRef.current?.scrollIntoView({ behavior: 'auto' });

    window.requestAnimationFrame(() => {

      doScroll();

      window.requestAnimationFrame(doScroll);

    });

  }, [hasLoadedHistory]);



  const hasActiveAnimations = useMemo(() => {
    const assistantTextDuration = (text: string) => text.length * 14 + 300;
    for (const msg of messages) {
      if (!isPlanMessage(msg)) continue;
      const startedAt = msg.plan.startedAt ?? 0;
      if (startedAt && now - startedAt < 60_000) return true;
      for (const task of msg.plan.tasks) {
        if (task.isDrafting) return true;
        if (task.draftTyping) {
          const perCharMs = 14;
          const duration = (task.draftTyping.fullText?.length ?? 0) * perCharMs + 500;
          if (now - task.draftTyping.startedAt < duration) return true;
        }
      }
    }
    for (const msg of messages) {
      if (!isAssistantTextMessage(msg)) continue;
      if (!msg.startedAt) continue;
      if (now - msg.startedAt < assistantTextDuration(msg.text)) return true;
    }
    return false;
  }, [messages, now]);


  useEffect(() => {

    if (!hasActiveAnimations) return;

    const interval = window.setInterval(() => setNow(Date.now()), 50);

    return () => window.clearInterval(interval);

  }, [hasActiveAnimations]);



  useEffect(() => {
    if (!hasActiveAnimations) return;
    const viewport = getScrollViewport();
    if (!viewport) return;

    const currentId = activeAutoscrollMessageIdRef.current;
    const currentMessage = currentId
      ? messages.find(m => m.id === currentId)
      : undefined;
    const stillAnimating = currentMessage
      ? isPlanMessage(currentMessage)
        ? isAssistantMessageAnimating(currentMessage)
        : isAssistantTextMessage(currentMessage) && currentMessage.startedAt
          ? now - currentMessage.startedAt < currentMessage.text.length * 14 + 300
          : false
      : false;
    if (currentId && !stillAnimating) {
      activeAutoscrollMessageIdRef.current = null;
    }

    if (!activeAutoscrollMessageIdRef.current) {
      const latestAnimating = [...messages]
        .reverse()
        .find(m => {
          if (isPlanMessage(m)) return isAssistantMessageAnimating(m);
          if (isAssistantTextMessage(m)) {
            return m.startedAt
              ? now - m.startedAt < m.text.length * 14 + 300
              : false;
          }
          return false;
        });
      if (latestAnimating) {
        activeAutoscrollMessageIdRef.current = latestAnimating.id;
      }
    }


    const activeId = activeAutoscrollMessageIdRef.current;

    if (!activeId) return;

    if (autoscrollDisabledForMessageRef.current.has(activeId)) return;

    if (!stickToBottomRef.current) return;



    lastAutoScrollAtRef.current = Date.now();

    bottomRef.current?.scrollIntoView({ behavior: 'auto' });

  }, [hasActiveAnimations, now]);



  useEffect(() => {

    if (!hasActiveAnimations) return;

    setMessages(prev =>
      {
        let didChange = false;
        const next = prev.map(msg => {
          if (!isPlanMessage(msg)) return msg;
          const { tasksStartAt } = getMessageAnimationTimings({
            startedAt: msg.plan.startedAt,
            summary: msg.plan.summary,
          });


          let taskChanged = false;

          const updatedTasks = msg.plan.tasks.map((task, index) => {

            if (!task.draftTyping) return task;

            const taskTitleText = getTaskTitleText(task.type);
            const question = task.followUpQuestions?.length
              ? cleanFollowUp(task.followUpQuestions.join(' '))
              : '';
            const hasFollowUp = Boolean(task.followUpQuestions?.length);
            const { draftSectionStartAt } = getTaskAnimationTimings({

              tasksStartAt,

              index,

              taskTitleText,

              question,

              hasFollowUp,

            });

            const perCharMs = 14;

            const totalMs = (task.draftTyping.fullText?.length ?? 0) * perCharMs;

            const effectiveStartAt = draftSectionStartAt

              ? Math.max(task.draftTyping.startedAt, draftSectionStartAt)

              : task.draftTyping.startedAt;

            if (now < effectiveStartAt + totalMs) return task;

            taskChanged = true;

            return { ...task, draft: task.draftTyping.fullText, draftTyping: undefined };

          });



          if (!taskChanged) return msg;

          didChange = true;

          return { ...msg, plan: { ...msg.plan, tasks: updatedTasks } };

        });



        return didChange ? next : prev;

      }

    );

  }, [hasActiveAnimations, now]);



  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {

    const selected = Array.from(event.target.files ?? []);

    if (selected.length === 0) return;



    if (pendingAttachments.length + selected.length > MAX_ATTACHMENTS) {

      toast({

        title: 'Too many files',

        description: `Attach up to ${MAX_ATTACHMENTS} files at a time.`,

        variant: 'destructive',

      });

      event.target.value = '';

      return;

    }



    const oversized = selected.find(f => f.size > MAX_ATTACHMENT_SIZE_BYTES);

    if (oversized) {

      toast({

        title: 'File too large',

        description: `"${oversized.name}" is ${formatBytes(oversized.size)}. Please attach files under ${formatBytes(

          MAX_ATTACHMENT_SIZE_BYTES

        )}.`,

        variant: 'destructive',

      });

      event.target.value = '';

      return;

    }



    try {

      const newlyRead = await Promise.all(

        selected.map(async file => {

          const dataUri = await readFileAsDataURL(file);

          const text = isTextLikeFile(file) ? await readFileAsText(file).catch(() => '') : '';

          const attachment: PendingAttachment = {

            name: file.name,

            dataUri,

            type: file.type,

            size: file.size,

            text: text ? text.slice(0, 10_000) : undefined,

          };

          return attachment;

        })

      );

      setPendingAttachments(prev => [...prev, ...newlyRead]);

    } catch (error: any) {

      console.error('Failed to read attachment', error);

      toast({

        title: 'Attachment failed',

        description: error?.message ?? 'Could not attach that file.',

        variant: 'destructive',

      });

    } finally {

      event.target.value = '';

    }

  };



  const removePendingAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: values.query,
    };

    setIsPlanning(true);
    setSendingId(null);
    stickToBottomRef.current = true;
    try {
      const treatAsInsight = isInsightQuery(values.query);
      if (pendingPlan && !treatAsInsight) {
        const questionsToResolve = normalizeQuestionList(pendingPlan.questions);
        const response = resolveFollowUpAnswersLocally(questionsToResolve, values.query);
        const answerMap = new Map(
          (response.answers || []).map((item: FollowUpAnswer) => [
            normalizeFollowUpQuestion(item.question),
            item.answer,
          ])
        );
        const tasksWithAttachments = pendingPlan.tasks.map(task => ({
          ...task,
          attachments:
            pendingAttachments.length > 0
              ? [...(task.attachments || []), ...pendingAttachments]
              : task.attachments,
        }));
        const updatedTasks = tasksWithAttachments.map(task => {
          const questionList =
            pendingPlan.taskQuestionMap[task.id] ?? (getMandatoryFollowUps(task) ?? []);
          if (questionList.length === 0) return task;
          const answersForTask = questionList
            .map(question => answerMap.get(normalizeFollowUpQuestion(question)))
            .filter((answer): answer is string => Boolean(answer));
          if (answersForTask.length === 0) return task;
          return {
            ...task,
            clarification: mergeClarifications(task.clarification, answersForTask),
          };
        });
        const hydratedTasks = hydrateTasksForDisplay(
          sanitizePlannedTasksForExecution(
            [pendingPlan.summary, values.query].filter(Boolean).join(' '),
            updatedTasks
          )
        );
        const combinedMissing = Array.from(
          new Set(
            hydratedTasks.flatMap(task => {
              const remainingQuestions =
                pendingPlan.taskQuestionMap[task.id] ?? (getMandatoryFollowUps(task) ?? []);
              return remainingQuestions.filter(
                question => !answerMap.has(normalizeFollowUpQuestion(question))
              );
            })
          )
        );
        const normalizedCombinedMissing = normalizeQuestionList(combinedMissing);
        if (combinedMissing.length > 0) {
          const followUpMessage: ChatMessage = {
            id: `followup-${Date.now()}`,
            sender: 'assistant',
            followUp: {
              questions: normalizedCombinedMissing,
              startedAt: Date.now(),
            },
          };
          if (normalizedCombinedMissing.length > 0) {
            const nextQuestionTaskMap = pendingPlan.questionTaskMap;
            const nextTaskQuestionMap = pendingPlan.taskQuestionMap;
            setMessages(prev => [...prev, userMessage, followUpMessage]);
            setPendingPlan({
              ...pendingPlan,
              tasks: hydratedTasks,
              questions: normalizedCombinedMissing,
              questionTaskMap: nextQuestionTaskMap,
              taskQuestionMap: nextTaskQuestionMap,
            });
            activeAutoscrollMessageIdRef.current = followUpMessage.id;
            autoscrollDisabledForMessageRef.current.delete(followUpMessage.id);
          } else {
            const planId = pendingPlan.planId;
            const resolvedTasks = hydratedTasks.map(task =>
              ensureTaskHasLocalDraft({
                ...task,
                followUpQuestions: undefined,
              })
            );
            const resolvedSummary = "All set - here's the draft.";
            setMessages(prev => [
              ...prev,
              userMessage,
              {
                id: planId,
                sender: 'assistant',
                plan: {
                  summary: resolvedSummary,
                  tasks: resolvedTasks,
                  startedAt: Date.now(),
                },
              },
            ]);
            activeAutoscrollMessageIdRef.current = planId;
            autoscrollDisabledForMessageRef.current.delete(planId);
            setPendingPlan(null);
          }
        } else {
          const planId = pendingPlan.planId;
          const resolvedTasks = hydratedTasks.map(task =>
            ensureTaskHasLocalDraft({
              ...task,
              followUpQuestions: undefined,
            })
          );
          const resolvedSummary = "All set - here's the draft.";
          setMessages(prev => [
            ...prev,
            userMessage,
            {
              id: planId,
              sender: 'assistant',
              plan: {
                summary: resolvedSummary,
                tasks: resolvedTasks,
                startedAt: Date.now(),
              },
            },
          ]);
          activeAutoscrollMessageIdRef.current = planId;
          autoscrollDisabledForMessageRef.current.delete(planId);
          setPendingPlan(null);
        }
      } else {
        const attachmentContext = buildAttachmentContextForAI(pendingAttachments);
        const queryWithAttachments = attachmentContext
          ? `${values.query}\n\n${attachmentContext}`
          : values.query;
        if (treatAsInsight) {
          if (pendingPlan) {
            console.info('[AI_DEBUG] Treating insight query as new request; clearing pending plan.');
            setPendingPlan(null);
          }
          const appContext = buildAppContextForAssistant();
          const assistantReplyResult = await runAssistantAction(values.query, appContext);
          const assistantReply =
            getResultData(
              assistantReplyResult as Result<AssistantReplyPayload>,
              handleAiError
            ) ?? {
              response: aiFallbackMessage,
            };
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            sender: 'assistant',
            text: assistantReply.response,
            startedAt: Date.now(),
          };
          setMessages(prev => [...prev, userMessage, assistantMessage]);
          activeAutoscrollMessageIdRef.current = assistantMessage.id;
          autoscrollDisabledForMessageRef.current.delete(assistantMessage.id);
          setPendingPlan(null);
          if (pendingAttachments.length > 0) {
            setPendingAttachments([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
          return;
        }
        const fastPlan = buildFastPlan(values.query, pendingAttachments);
        const contextForPlanner = buildRecentContextForPlanner();
        const plannerResponse = getResultData(
          (await planTasksAction(
            queryWithAttachments,
            contextForPlanner
          )) as Result<PlannerPayload>,
          handleAiError
        );
        const plan =
          plannerResponse && Array.isArray(plannerResponse.tasks) && plannerResponse.tasks.length > 0
            ? plannerResponse
            : fastPlan ?? {
                tasks: [],
                summary:
                  "I can create task boxes for announcements, emails, messages, calendar events, forms, gallery uploads, and transactions. Ask for one of those directly.",
              };
        const normalizedPlan = {
          ...plan,
          tasks: sanitizePlannedTasksForExecution(
            values.query,
            (plan.tasks ?? []).map(task => ({
              ...task,
              status: (task as PlannedTask).status ?? 'pending',
            }))
          ),
        };
        const planId = `plan-${Date.now()}`;
        const allowedTaskTypes = canManageRoles
          ? null
          : new Set<TaskType>(['messages', 'gallery']);
        const rawTasks = allowedTaskTypes
          ? normalizedPlan.tasks.filter(task => allowedTaskTypes.has(task.type))
          : normalizedPlan.tasks;
        if (!canManageRoles && rawTasks.length === 0) {
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            sender: 'assistant',
            text: normalizedPlan.summary || aiFallbackMessage,
            startedAt: Date.now(),
          };
          setMessages(prev => [...prev, userMessage, assistantMessage]);
          activeAutoscrollMessageIdRef.current = assistantMessage.id;
          autoscrollDisabledForMessageRef.current.delete(assistantMessage.id);
          setPendingPlan(null);
          if (pendingAttachments.length > 0) {
            setPendingAttachments([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
          return;
        }
        const plannedTasks = hydrateTasksForDisplay(
          rawTasks.map(task => ({
            ...task,
            status: 'pending' as const,
            clarification: '',
            draft: task.draft ?? '',
            draftSource: task.draftSource ?? task.draft,
            draftError: undefined,
            isDrafting: false,
            autoDraftRequested: true,
            attachments: pendingAttachments,
          }))
        );
        const hasRunnableTask = plannedTasks.some(t => t.type !== 'other');
        const fallbackPrompt = plannedTasks.find(t => t.type === 'other')?.prompt?.trim();
        const safeSummary = hasRunnableTask
          ? normalizedPlan.summary
          : fallbackPrompt ||
            `Sorry - I can't do that in ${appBrandName} yet. Try asking for an announcement, a form, a calendar event, an email, a message, a gallery upload, or a transaction.`;
        const {
          questions: rawFollowUps,
          questionTaskMap,
          taskQuestionMap,
        } = buildFollowUpQuestionData(plannedTasks);
        const finalFollowUps = normalizeQuestionList(rawFollowUps);
        const isNonTaskRequest = !hasRunnableTask && finalFollowUps.length === 0;

        if (isNonTaskRequest) {
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            sender: 'assistant',
            text: safeSummary || aiFallbackMessage,
            startedAt: Date.now(),
          };
          setMessages(prev => [...prev, userMessage, assistantMessage]);
          activeAutoscrollMessageIdRef.current = assistantMessage.id;
          autoscrollDisabledForMessageRef.current.delete(assistantMessage.id);
          setPendingPlan(null);
        } else if (finalFollowUps.length > 0) {
          const followUpMessage: ChatMessage = {
            id: `followup-${Date.now()}`,
            sender: 'assistant',
            followUp: {
              questions: finalFollowUps,
              startedAt: Date.now(),
            },
          };
          setMessages(prev => [...prev, userMessage, followUpMessage]);
          setPendingPlan({
            planId,
            summary: safeSummary,
            tasks: plannedTasks,
            questions: finalFollowUps,
            questionTaskMap,
            taskQuestionMap,
          });
          activeAutoscrollMessageIdRef.current = followUpMessage.id;
          autoscrollDisabledForMessageRef.current.delete(followUpMessage.id);
        } else {
          const tasksToRender = hasRunnableTask ? plannedTasks : [];
          setMessages(prev => [
            ...prev,
            userMessage,
            {
              id: planId,
              sender: 'assistant',
              plan: {
                summary: safeSummary,
                tasks: tasksToRender,
                startedAt: Date.now(),
              },
            },
          ]);
          activeAutoscrollMessageIdRef.current = planId;
          autoscrollDisabledForMessageRef.current.delete(planId);
        }

      }
      if (pendingAttachments.length > 0) {
        setPendingAttachments([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('Assistant planner error:', error);
      toast({
        title: 'Assistant error',
        description: error?.message ?? 'Failed to plan tasks.',
        variant: 'destructive',

      });

    } finally {

      setIsPlanning(false);

      form.reset();

    }

  };



  const updatePlanTask = (
    planId: string,
    taskId: string,
    updater: (task: PlannedTask) => PlannedTask
  ) => {
    setMessages(prev =>
      prev.map(msg => {
        if (!isPlanMessage(msg) || msg.id !== planId) return msg;
        return {
          ...msg,
          plan: {
            ...msg.plan,
            tasks: msg.plan.tasks.map(t => (t.id === taskId ? updater(t) : t)),
          },
        };
      })
    );
  };

  const cleanFollowUp = (text?: string) => {
    if (!text) return '';
    return text.replace(/\?+$/, '');
  };

  const resolveFollowUpAnswersLocally = (questions: string[], reply: string) => {
    const normalizedQuestions = normalizeQuestionList(questions);
    const trimmedReply = reply.trim();
    if (!trimmedReply) {
      return {
        answers: [] as FollowUpAnswer[],
        missing: normalizedQuestions,
      };
    }

    if (normalizedQuestions.length <= 1) {
      return {
        answers: normalizedQuestions.map(question => ({ question, answer: trimmedReply })),
        missing: [] as string[],
      };
    }

    const chunks = trimmedReply
      .split(/\n+|;\s+|,\s+/)
      .map(chunk => chunk.replace(/^\s*(?:[-*]|\d+[\).:-]?)\s*/, '').trim())
      .filter(Boolean);

    if (chunks.length >= normalizedQuestions.length) {
      return {
        answers: normalizedQuestions
          .map((question, index) => ({
            question,
            answer: chunks[index] ?? '',
          }))
          .filter(item => item.answer),
        missing: [] as string[],
      };
    }

    return {
      answers:
        normalizedQuestions.length > 0
          ? [{ question: normalizedQuestions[0], answer: trimmedReply }]
          : [],
      missing: normalizedQuestions.slice(1),
    };
  };

  const normalizeFollowUpQuestion = (text?: string) => {
    if (!text) return '';
    return text.replace(/\?+$/, '').trim();
  };

  const formatSingleFollowUpText = (question: string) => {
    const cleaned = normalizeFollowUpQuestion(question);
    if (!cleaned) return 'Tell me that detail before I draft it.';
    const lower = cleaned.replace(/^[A-Z]/, match => match.toLowerCase());
    return `Tell me ${lower} before I draft it.`;
  };

  const normalizeRecipient = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/["'.!,?()[\]{}]/g, '')
      .replace(/\s+/g, ' ');

  const getConversationId = (email1: string, email2: string) =>
    [email1, email2].sort().join('_');

  const normalizeQuestionList = (questions: string[]) =>
    Array.from(
      new Set(questions.map(normalizeFollowUpQuestion).filter(Boolean))
    );

  const buildFollowUpQuestionData = (tasks: PlannedTask[]) => {
    const questions: string[] = [];
    const questionTaskMap: Record<string, string[]> = {};
    const taskQuestionMap: Record<string, string[]> = {};

    tasks.forEach(task => {
      const taskQuestions = normalizeQuestionList(getMandatoryFollowUps(task) ?? []);
      if (taskQuestions.length === 0) return;
      taskQuestionMap[task.id] = taskQuestions;
      taskQuestions.forEach(question => {
        if (!questionTaskMap[question]) {
          questionTaskMap[question] = [task.id];
          questions.push(question);
          return;
        }
        if (!questionTaskMap[question].includes(task.id)) {
          questionTaskMap[question].push(task.id);
        }
      });
    });

    return { questions, questionTaskMap, taskQuestionMap };
  };

  const mergeClarifications = (existing: string | undefined, additions: string[]) => {
    const base = (existing ?? '').trim();
    const cleanAdditions = additions.map(item => item.trim()).filter(Boolean);
    if (cleanAdditions.length === 0) return base;
    if (!base) return cleanAdditions.join('\n');
    const seen = new Set(
      base
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    );
    const uniqueAdditions = cleanAdditions.filter(item => !seen.has(item));
    if (uniqueAdditions.length === 0) return base;
    return `${base}\n${uniqueAdditions.join('\n')}`;
  };

  const formatDateForDisplay = (dateValue: string | number | Date | undefined) => {
    if (!dateValue) return '';
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return String(dateValue);
    return parsed.toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    });
  };
  const formatTimeForDisplay = (dateValue: string | number | Date | undefined) => {
    if (!dateValue) return '';
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).toLowerCase();
  };

  const formatAssistantTextForDisplay = (text: string) => {
    const withoutBold = text.replace(/\*\*(.*?)\*\*/g, '$1');
    const withFormattedDateTimes = withoutBold.replace(
      /\b(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|\s*UTC)?\b/g,
      (_match, year, month, day, hour, minute) => {
        const hours = Number(hour);
        const minutes = Number(minute);
        const period = hours >= 12 ? 'pm' : 'am';
        const displayHour = ((hours + 11) % 12) + 1;
        const displayMinute = minutes.toString().padStart(2, '0');
        return `${Number(month)}/${Number(day)}/${year}\nTime: ${displayHour}:${displayMinute} ${period}`;
      }
    );
    const withFormattedDates = withFormattedDateTimes.replace(
      /\b(\d{4})-(\d{2})-(\d{2})\b/g,
      (_match, year, month, day) => `${Number(month)}/${Number(day)}/${year}`
    );
    return withFormattedDates.replace(/\s*UTC\b/g, '');
  };
  const formatLocationForDisplay = (value: string | null | undefined) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || trimmed === '0') return 'NA';
    return trimmed;
  };

  const normalizeFormQuestions = (questions: any[]): FormQuestion[] => {
    const safeQuestions = Array.isArray(questions) ? questions : [];
    const normalized = safeQuestions
      .filter(q => q && typeof q.prompt === 'string' && q.prompt.trim())
      .slice(0, 8)
      .map(q => {
        const rawKind = typeof q.kind === 'string' ? q.kind : 'shortText';
        const kind =
          rawKind === 'single' || rawKind === 'multi' || rawKind === 'file'
            ? rawKind
            : 'shortText';
        const options = Array.isArray(q.options)
          ? q.options.map((opt: any) => String(opt).trim()).filter(Boolean)
          : [];
        const needsOptions = kind === 'single' || kind === 'multi';
        return {
          id: crypto.randomUUID(),
          prompt: q.prompt.trim(),
          required: Boolean(q.required),
          kind,
          options: needsOptions ? options.slice(0, 6) : undefined,
        };
      });

    if (normalized.length === 0) {
      return [
        {
          id: crypto.randomUUID(),
          prompt: 'Your response',
          required: true,
          kind: 'shortText',
        },
      ];
    }

    return normalized.map(q => {
      if ((q.kind === 'single' || q.kind === 'multi') && (!q.options || q.options.length === 0)) {
        return { ...q, options: ['Option 1', 'Option 2'] };
      }
      if (q.kind === 'shortText' || q.kind === 'file') {
        return { ...q, options: undefined };
      }
      return q;
    });
  };

  const formatDraft = (type: TaskType, result: any) => {
    const r = result ?? {};
    switch (type) {
      case 'announcement':
        return r.announcement ?? '';
      case 'form': {
        const questions = Array.isArray(r.questions) ? r.questions : [];
        const questionLines =
          questions.length > 0
            ? questions
                .map((q: any, idx: number) => {
                  const prompt = typeof q?.prompt === 'string' ? q.prompt : '';
                  const kind = typeof q?.kind === 'string' ? q.kind : 'shortText';
                  const required = q?.required ? ' (required)' : '';
                  const options = Array.isArray(q?.options) ? q.options.filter(Boolean) : [];
                  const optionsText = options.length > 0 ? ` [${options.join(', ')}]` : '';
                  return `${idx + 1}. ${prompt} (${kind})${required}${optionsText}`;
                })
                .join('\n')
            : 'No questions generated.';
        return `Title: ${r.title ?? ''}\nDescription: ${r.description ?? ''}\n\nQuestions:\n${questionLines}`;
      }
      case 'calendar': {
        const friendlyDate = formatDateForDisplay(r.date);
        const hasTime = typeof r.hasTime === 'boolean' ? r.hasTime : true;
        const friendlyTime = hasTime ? formatTimeForDisplay(r.date) : 'NA';
        const location = formatLocationForDisplay(r.location);
        return `Title: ${r.title ?? ''}\nDate: ${friendlyDate}\nTime: ${friendlyTime}\nLocation: ${location}\n\nDetails:\n${r.description ?? ''}`;
      }
      case 'email':
        return `Subject: ${r.subject ?? ''}\n\n${r.body ?? ''}`;
      case 'messages':
        return r.text ?? '';
      case 'transaction':
        const friendlyDate = formatDateForDisplay(r.date);
        return `Description: ${r.description ?? ''}\nAmount: ${r.amount ?? ''}\nDate: ${friendlyDate}\nStatus: ${r.status ?? ''}`;
      case 'gallery':
        return r.description ?? '';
      case 'other':
        return r.message ?? r.prompt ?? r.text ?? '';
      default:
        return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
    }
  };

  const resolveMessageTarget = (
    recipient: string,
    recipientType?: string
  ): { kind: 'dm'; email: string } | { kind: 'group'; id: string } | null => {
    const normalized = normalizeRecipient(recipient);
    const memberList = Array.isArray(members.data) ? members.data : [];
    const groupList = Array.isArray(groupChats.data) ? groupChats.data : [];
    const currentUserEmail = normalizeRecipient(user?.email ?? '');

    const findMember = () => {
      const exactMatch = memberList.find(member => {
        const normalizedEmail = normalizeRecipient(member.email);
        const normalizedName = normalizeRecipient(member.name);
        return normalizedEmail === normalized || normalizedName === normalized;
      });
      if (exactMatch) return exactMatch;

      const tokenizedRecipient = normalized.split(' ').filter(Boolean);
      if (tokenizedRecipient.length === 0) return null;

      const fuzzyMatches = memberList.filter(member => {
        const normalizedName = normalizeRecipient(member.name);
        const nameTokens = normalizedName.split(' ').filter(Boolean);
        const normalizedEmail = normalizeRecipient(member.email);
        const emailBase = normalizedEmail.split('@')[0] ?? '';

        if (normalizedName.includes(normalized) || normalized.includes(normalizedName)) {
          return true;
        }

        if (emailBase === normalized || emailBase.includes(normalized)) {
          return true;
        }

        return tokenizedRecipient.every(token =>
          nameTokens.some(nameToken => nameToken.startsWith(token)) ||
          emailBase.split(/[._-]/).some(part => part.startsWith(token))
        );
      });

      if (fuzzyMatches.length === 0) return null;
      return (
        fuzzyMatches.find(member => normalizeRecipient(member.email) !== currentUserEmail) ??
        fuzzyMatches[0]
      );
    };
    const findMemberByRoleAlias = () => {
      const roleAliasMap: Record<string, Array<'Admin' | 'Officer' | 'Member'>> = {
        admin: ['Admin'],
        admins: ['Admin'],
        officer: ['Officer'],
        officers: ['Officer'],
        member: ['Member'],
        members: ['Member'],
      };
      const allowedRoles = roleAliasMap[normalized];
      if (!allowedRoles) return null;
      const matchingMembers = memberList.filter(member => allowedRoles.includes(member.role));
      if (matchingMembers.length === 0) return null;
      return (
        matchingMembers.find(member => normalizeRecipient(member.email) !== currentUserEmail) ??
        matchingMembers[0]
      );
    };
    const findGroup = () =>
      groupList.find(chat => normalizeRecipient(chat.name) === normalized);

    if (recipientType === 'group') {
      const group = findGroup();
      return group ? { kind: 'group', id: group.id } : null;
    }
    if (recipientType === 'person') {
      const member = findMember() ?? findMemberByRoleAlias();
      return member ? { kind: 'dm', email: member.email } : null;
    }

    const member = findMember() ?? findMemberByRoleAlias();
    if (member) return { kind: 'dm', email: member.email };
    const group = findGroup();
    return group ? { kind: 'group', id: group.id } : null;
  };

  const buildLocalMessageDraft = (task: PlannedTask) => {
    if (task.type !== 'messages') return null;
    if (Array.isArray(task.attachments) && task.attachments.length > 0) return null;

    const rawPrompt = [task.prompt?.trim(), task.clarification?.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!rawPrompt) return null;

    const patterns = [
      /^(?:send|write|draft)\s+(?:a\s+)?(?:message|dm|text)\s+(?:to\s+)?(.+?)\s+(?:saying|that says|about|to)\s+(.+)$/i,
      /^(?:message|text|dm|tell|ask|remind|notify)\s+(.+?)\s+to\s+(.+)$/i,
    ];

    let recipient = '';
    let content = '';
    for (const pattern of patterns) {
      const match = rawPrompt.match(pattern);
      if (!match) continue;
      recipient = (match[1] ?? '').trim();
      content = (match[2] ?? '').trim();
      if (recipient && content) break;
    }

    if (!recipient || !content) return null;

    const target = resolveMessageTarget(recipient, 'person') ?? resolveMessageTarget(recipient);
    if (!target) return null;

    const recipientName =
      target.kind === 'dm'
        ? resolveMemberName(target.email)
        : recipient;
    const normalizedContent = content.replace(/^[,:\-\s]+/, '').trim();
    if (!normalizedContent) return null;

    const text = /^(hi|hello|hey|dear)\b/i.test(normalizedContent)
      ? normalizedContent
      : `Hi ${recipientName}, ${normalizedContent.replace(/[.!?]*$/, '')}.`;

    return {
      recipient,
      recipientType: target.kind === 'group' ? 'group' : 'person',
      text,
    };
  };

  const startCase = (value: string) =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const cleanTaskIntent = (value: string) => {
    return value
      .replace(/\b(send|write|draft|create|make|post|email|announcement|announce|message|text|dm)\b/gi, ' ')
      .replace(/\b(to|for)\s+(everyone|everybody|all|the whole group|the entire group)\b/gi, ' ')
      .replace(/[,:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const extractReminderTopic = (value: string) => {
    const normalized = value.trim();
    const reminderMatch =
      normalized.match(/\bremind(?:ing)?(?:\s+\w+){0,4}\s+to\s+(.+)$/i) ??
      normalized.match(/\babout\s+(.+)$/i);
    return (reminderMatch?.[1] ?? normalized).replace(/[.?!]+$/, '').trim();
  };

  const extractEventDate = (value: string) =>
    value.match(/\btomorrow\b|\btonight\b|\bnext\s+\w+\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+\d{1,2}(?:,\s*\d{4})?\b/i)?.[0] ?? '';

  const extractEventTime = (value: string) =>
    value.match(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b|\bmidnight\b/i)?.[0] ?? '';

  const extractEventLocation = (value: string) =>
    value.match(/\bat\s+([^,.!?]+(?:school|center|hall|room|gym|auditorium|cafeteria|library|park)?)\b/i)?.[1]?.trim() ?? '';

  const extractEventTopic = (value: string) => {
    const normalized = value.trim();
    const explicitMatch =
      normalized.match(/\bit'?s\s+(?:a|an)\s+([^,.!?]+)/i) ??
      normalized.match(/\bit is\s+(?:a|an)\s+([^,.!?]+)/i) ??
      normalized.match(/\bcalled\s+([^,.!?]+)/i) ??
      normalized.match(/\bnamed\s+([^,.!?]+)/i);
    if (explicitMatch?.[1]) return explicitMatch[1].trim();
    const reminderTopic = extractReminderTopic(normalized);
    return reminderTopic
      .replace(/\b(?:tomorrow|tonight|at\s+\d{1,2}(?::\d{2})?\s?(?:am|pm)|at\s+[^,.!?]+)\b/gi, '')
      .replace(/\b(?:come to|join|attend)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const getCalendarFollowUps = (task: PlannedTask) => {
    const combined = [task.prompt?.trim(), task.clarification?.trim()].filter(Boolean).join(' ').trim();
    if (!combined) {
      return ['What is the event date?', 'What time is the event?', 'What is the event about?'];
    }
    const missing: string[] = [];
    if (!extractEventDate(combined)) missing.push('What is the event date?');
    if (!extractEventTime(combined)) missing.push('What time is the event?');
    if (!extractEventTopic(combined)) missing.push('What is the event about?');
    return missing;
  };

  const getMandatoryFollowUps = (task: PlannedTask) => {
    if (task.type === 'announcement') return undefined;
    if (task.type === 'email') return undefined;
    if (task.type === 'messages') {
      const combined = [task.prompt?.trim(), task.clarification?.trim()].filter(Boolean).join(' ').trim();
      const needsRecipient = !buildLocalMessageDraft({ ...task, prompt: combined || task.prompt });
      return needsRecipient ? ['Who should receive the message?'] : undefined;
    }
    if (task.type === 'calendar') {
      const missing = getCalendarFollowUps(task);
      return missing.length > 0 ? missing : undefined;
    }
    if (task.type === 'form') {
      return /\bquestion\b|\bquestions\b|\?/.test(
        [task.prompt, task.clarification].filter(Boolean).join(' ').toLowerCase()
      )
        ? undefined
        : ['Please list the questions you want in the form and any answer choices for multiple-choice questions.'];
    }
    if (task.type === 'gallery') {
      return Array.isArray(task.attachments) && task.attachments.length > 0
        ? undefined
        : ['Please attach at least one image.'];
    }
    if (task.type === 'transaction') {
      return /\$?\d+(?:\.\d{2})?\b/.test([task.prompt, task.clarification].filter(Boolean).join(' '))
        ? undefined
        : ['What is the amount?'];
    }
    return task.followUpQuestions;
  };

  const explicitCalendarIntentInText = (value: string) =>
    /\b(calendar|schedule|add (?:an )?event|create (?:an )?event|put (?:it|this) on (?:the )?calendar)\b/i.test(
      value
    );

  const sanitizePlannedTasksForExecution = (query: string, tasks: PlannedTask[]) => {
    const lower = query.trim().toLowerCase();
    const hasExplicitCalendarIntent = explicitCalendarIntentInText(lower);
    const hasAnnouncementLikeIntent =
      /\b(remind|announcement|announce|tell everyone|notify everyone)\b/.test(lower);

    const filteredTasks = tasks.filter(task => {
      if (task.type !== 'calendar') return true;
      if (hasExplicitCalendarIntent) return true;
      if (hasAnnouncementLikeIntent) return false;
      return false;
    });

    return filteredTasks.map(task => {
      if (task.type === 'announcement') {
        return {
          ...task,
          followUpQuestions: getMandatoryFollowUps(task),
        };
      }
      if (task.type === 'email') {
        return {
          ...task,
          followUpQuestions: getMandatoryFollowUps(task),
        };
      }
      if (task.type === 'messages') {
        return {
          ...task,
          followUpQuestions: getMandatoryFollowUps(task),
        };
      }
      if (task.type === 'calendar') {
        return {
          ...task,
          followUpQuestions: getMandatoryFollowUps(task),
        };
      }
      if (task.type === 'form' || task.type === 'gallery' || task.type === 'transaction') {
        return {
          ...task,
          followUpQuestions: getMandatoryFollowUps(task),
        };
      }
      return task;
    });
  };

  function deriveAnnouncementTitle(draftText: string, promptText?: string) {
    const source = [draftText, promptText ?? ''].filter(Boolean).join(' ').trim().toLowerCase();
    const topicMatchers: Array<[RegExp, string]> = [
      [/\bblood drive\b/, 'Blood Drive Reminder'],
      [/\bclub dues\b|\bdues\b/, 'Dues Reminder'],
      [/\bbanquet\b/, 'Banquet Reminder'],
      [/\bsocial\b/, 'Social Reminder'],
      [/\bmeeting\b/, 'Meeting Reminder'],
      [/\bevent\b/, 'Event Reminder'],
      [/\bpayment\b|\bpay\b/, 'Payment Reminder'],
      [/\bform\b/, 'Form Reminder'],
    ];
    for (const [pattern, title] of topicMatchers) {
      if (pattern.test(source)) {
        return title;
      }
    }

    const firstNonEmptyLine =
      draftText
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean) ?? '';
    const cleanedLine = firstNonEmptyLine
      .replace(/^(this is a reminder to|reminder|announcement)\s*:?\s*/i, '')
      .replace(/\bfailure to do so.*$/i, '')
      .replace(/\bplease\b/gi, '')
      .replace(/[.!?]+$/, '')
      .trim();
    const words = cleanedLine.split(/\s+/).filter(Boolean);
    const condensed = words.slice(0, 4).join(' ');
    const fallback = startCase(extractReminderTopic(cleanTaskIntent(promptText ?? ''))).slice(0, 40);
    const baseTitle = startCase(condensed || fallback || 'Announcement');
    return baseTitle.length > 48 ? `${baseTitle.slice(0, 45).trimEnd()}...` : baseTitle;
  }

  const buildLocalDraftResult = (task: PlannedTask) => {
    const messageDraft = buildLocalMessageDraft(task);
    if (messageDraft) return messageDraft;

    const combined = [task.prompt?.trim(), task.clarification?.trim()].filter(Boolean).join(' ').trim();
    if (!combined) return null;
    const cleanedIntent = cleanTaskIntent(combined);
    const topic = extractReminderTopic(cleanedIntent || combined) || cleanedIntent || combined;

    switch (task.type) {
      case 'announcement': {
        const eventTopic = extractEventTopic(combined) || topic;
        const eventDate = extractEventDate(combined);
        const eventTime = extractEventTime(combined);
        const eventLocation = extractEventLocation(combined);
        const details = [eventDate, eventTime, eventLocation].filter(Boolean).join(', ');
        const announcementBase = eventTopic ? `${startCase(eventTopic)}` : `${startCase(topic)}`;
        const announcement = details
          ? `Reminder: ${announcementBase} is ${details}.`
          : `Reminder: ${announcementBase}.`;
        return {
          title: deriveAnnouncementTitle(announcement, task.prompt),
          announcement,
        };
      }
      case 'email': {
        const subjectTopic = startCase(topic).slice(0, 70) || 'Update';
        const bodyTopic = topic.replace(/[.?!]+$/, '');
        return {
          subject: subjectTopic.startsWith('Reminder') ? subjectTopic : `Reminder: ${subjectTopic}`,
          body: `Hi everyone,\n\nThis is a reminder to ${bodyTopic}.\n\nThank you.`,
        };
      }
      case 'calendar': {
        const dateText = extractEventDate(combined);
        const timeText = extractEventTime(combined);
        const topicText = extractEventTopic(combined);
        const locationText = extractEventLocation(combined);
        const title = startCase(topicText || cleanedIntent || 'Event').slice(0, 80) || 'Event';
        const parsedDate = new Date(
          `${dateText || new Date().toLocaleDateString()} ${timeText || ''}`.trim()
        );
        return {
          title,
          date: Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString(),
          location: locationText,
          description: topicText ? `${startCase(topicText)}` : combined,
          hasTime: Boolean(timeText),
        };
      }
      case 'transaction': {
        const amountMatch = combined.match(/\$?\d+(?:\.\d{2})?/);
        const amountText = amountMatch?.[0] ?? '';
        const amount = Number(amountText.replace(/[^0-9.-]/g, ''));
        return {
          description: startCase(cleanedIntent || combined).slice(0, 100),
          amount: Number.isFinite(amount) ? amount : amountText,
          date: new Date().toISOString(),
          status: 'completed',
        };
      }
      case 'gallery':
        return {
          description: startCase(topic).slice(0, 120),
        };
      case 'other':
        return { message: combined };
      default:
        return null;
    }
  };

  const ensureTaskHasLocalDraft = (task: PlannedTask): PlannedTask => {
    const baseTask: PlannedTask = {
      ...task,
      draftSource:
        typeof task.draft === 'string' && task.draft.trim().length > 0
          ? task.draft
          : task.draftSource,
      autoDraftRequested: true,
    };
    if (typeof baseTask.draft === 'string' && baseTask.draft.trim().length > 0) {
      if (baseTask.type === 'announcement') {
        const ensuredTitle =
          typeof baseTask.title === 'string' && baseTask.title.trim().length > 0
            ? baseTask.title.trim()
            : deriveAnnouncementTitle(baseTask.draft, baseTask.prompt);
        if (baseTask.draftResult) {
          return {
            ...baseTask,
            title: ensuredTitle,
            draftResult:
              typeof baseTask.draftResult === 'object' && baseTask.draftResult
                ? { ...baseTask.draftResult, title: ensuredTitle }
                : baseTask.draftResult,
          };
        }
        return {
          ...baseTask,
          title: ensuredTitle,
          draftResult: {
            title: ensuredTitle,
            announcement: baseTask.draft,
          },
        };
      }
      return baseTask;
    }
    const localDraftResult = buildLocalDraftResult(baseTask);
    if (!localDraftResult) {
      return baseTask;
    }
    const draftText = formatDraft(baseTask.type, localDraftResult);
    return {
      ...baseTask,
      draft: draftText,
      draftSource: draftText,
      draftResult: localDraftResult,
    };
  };

  const hydrateTasksForDisplay = (tasks: PlannedTask[]) =>
    tasks.map(task => ensureTaskHasLocalDraft(task));


  const toAppRoute = (path: string) => {
    if (!isDemoAssistantRoute) return path;
    if (path === '/dashboard') return '/demo/app';
    if (path.startsWith('/demo/app')) return path;
    return `/demo/app${path}`;
  };

  const getRouteForTaskType = (type: TaskType) => {
    switch (type) {
      case 'announcement':
        return toAppRoute('/announcements');
      case 'form':
        return toAppRoute('/forms');
      case 'calendar':

        return toAppRoute('/calendar');

      case 'email':
        return toAppRoute('/email');
      case 'messages':
        return toAppRoute('/messages');
      case 'transaction':
        return toAppRoute('/finances');
      case 'gallery':
        return toAppRoute('/gallery');
      default:
        return toAppRoute('/dashboard');
    }
  };


  const generateDraft = async (planId: string, task: PlannedTask) => {
    const draftKey = `${planId}:${task.id}`;
    if (draftGenerationInFlightRef.current.has(draftKey)) {
      return;
    }
    draftGenerationInFlightRef.current.add(draftKey);
    try {
      if (task.type === 'other') {
        updatePlanTask(planId, task.id, t => ({
          ...t,
          draft: task.prompt,
          draftError: undefined,
          isDrafting: false,
          autoDraftRequested: true,
        }));
        return;
      }

      const clar = task.clarification?.trim();
      const linkedFormId =
        task.type === 'announcement'
          ? task.linkedFormId || (task.linkedFormTaskId ? formTaskIdMap[task.linkedFormTaskId] : undefined)
          : undefined;
      const linkedFormTitle = linkedFormId
        ? recentForms.find(form => form.id === linkedFormId)?.title ||
          (Array.isArray(forms.data)
            ? forms.data.find((form: ClubForm) => form.id === linkedFormId)?.title
            : undefined)
        : undefined;
      const attachmentContext = buildAttachmentContextForAI(task.attachments);
      const promptForDraftBase = clar
        ? `${task.prompt}\nClarification: ${clar}`
        : task.prompt;
      const promptForDraft = [
        promptForDraftBase,
        linkedFormTitle ? `Linked form title: "${linkedFormTitle}"` : null,
        attachmentContext ? attachmentContext : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      updatePlanTask(planId, task.id, t => ({
        ...t,
        isDrafting: true,
        autoDraftRequested: true,
        draftingStartedAt: Date.now(),
        draftError: undefined,
      }));

      const localMessageDraft = buildLocalMessageDraft(task);
      if (localMessageDraft) {
        const draftText = formatDraft(task.type, localMessageDraft);
        updatePlanTask(planId, task.id, t => ({
          ...t,
          draft: '',
          draftSource: draftText,
          draftTyping: { startedAt: Date.now(), fullText: draftText },
          isDrafting: false,
          draftingStartedAt: undefined,
          draftError: undefined,
          draftResult: localMessageDraft,
        }));
        return;
      }

      const previewResult = await runTaskAction(task.type, promptForDraft);
      const preview =
        getResultData(previewResult, message =>
          toast({
            title: 'AI unavailable',
            description: message,
            variant: 'destructive',
          })
        ) ?? null;
      if (!preview) {
        updatePlanTask(planId, task.id, t => ({
          ...t,
          isDrafting: false,
          draftingStartedAt: undefined,
          draftError: aiFallbackMessage,
        }));
        return;
      }
      const draftText = formatDraft(task.type, preview);

      updatePlanTask(planId, task.id, t => ({
        ...t,
        draft: '',
        draftSource: draftText,
        draftTyping: { startedAt: Date.now(), fullText: draftText },
        isDrafting: false,
        draftingStartedAt: undefined,
        draftError: undefined,
        draftResult: preview,
      }));
    } finally {
      draftGenerationInFlightRef.current.delete(draftKey);
    }
  };

  const requestDraftGeneration = (planId: string, task: PlannedTask) => {
    const draftKey = `${planId}:${task.id}`;
    if (draftGenerationInFlightRef.current.has(draftKey)) {
      return;
    }
    if (task.isDrafting) {
      return;
    }
    if (task.draft?.trim()) {
      setDraftRegenerationRequest({ planId, task });
      return;
    }
    void generateDraft(planId, task);
  };



  const runTask = async (planId: string, task: PlannedTask) => {
    setSendingId(task.id);

    if (task.type === 'other') {
      updatePlanTask(planId, task.id, t => ({
        ...t,
        status: 'sent',
        result: { message: task.prompt },
        error: undefined,
      }));
      setSendingId(null);
      return;
    }
    if (task.type === 'announcement') {
      if (Array.isArray(task.recipients) && task.recipients.length === 0) {
        updatePlanTask(planId, task.id, t => ({
          ...t,
          status: 'error',
          error: 'Please add at least one recipient or keep everyone.',
        }));
        setSendingId(null);
        return;
      }
    }

      const clar = task.clarification?.trim();

      const finalDraft = task.draft?.trim();
      const linkedFormId =
        task.type === 'announcement'
          ? task.linkedFormId || (task.linkedFormTaskId ? formTaskIdMap[task.linkedFormTaskId] : undefined)
          : undefined;
      const linkedFormTitle = linkedFormId
        ? recentForms.find(form => form.id === linkedFormId)?.title ||
          (Array.isArray(forms.data)
            ? forms.data.find((form: ClubForm) => form.id === linkedFormId)?.title
            : undefined)
        : undefined;
      const attachmentContext = buildAttachmentContextForAI(task.attachments);
      const finalPrompt = [
        `Original instructions: ${task.prompt}`,
        clar ? `Clarification: ${clar}` : null,
        linkedFormTitle ? `Linked form title: "${linkedFormTitle}"` : null,
        attachmentContext ? attachmentContext : null,
        finalDraft
          ? `Final content to use as-is (do not rewrite):\n${finalDraft}`
          : null,
      ]
      .filter(Boolean)

      .join('\n\n');



    const persistResult = (type: TaskType, result: any) => {

      const authorName = user?.name || 'AI Assistant';
      const authorEmail = user?.email || 'ai@CASPO.local';
      switch (type) {
        case 'announcement': {
            announcements.updateData(prev => {
              const list = Array.isArray(prev) ? prev : [];
              const attachmentsFromTask = Array.isArray(task.attachments)
                ? task.attachments.map(({ name, dataUri, type }) => ({ name, dataUri, type }))
                : [];
              const buttonAttachment = linkedFormId
                ? {
                    name: 'Fill out the form',
                    dataUri: `${getRouteForTaskType('form')}?formId=${encodeURIComponent(linkedFormId)}`,
                    type: 'button',
                  }
                : null;
              const hasButtonAttachment = attachmentsFromTask.some(att => att.type === 'button');
              const attachmentsToPersist =
                buttonAttachment && !hasButtonAttachment
                  ? [...attachmentsFromTask, buttonAttachment]
                  : attachmentsFromTask;
              const announcementId = Date.now();
              const recipients = Array.isArray(task.recipients) ? task.recipients : [];
              const savedAnnouncementTitle = deriveAnnouncementTitle(
                finalDraft || result.announcement || '',
                task.prompt
              );
              const finalAnnouncementTitle =
                typeof task.title === 'string' && task.title.trim()
                  ? task.title.trim()
                  : typeof result?.title === 'string' && result.title.trim()
                    ? result.title.trim()
                    : savedAnnouncementTitle;
              const newItem = {
                id: announcementId,
                title: finalAnnouncementTitle,
                content: finalDraft || result.announcement || '',
                author: authorName,
                date: new Date().toISOString(),
                read: false,
                attachments: attachmentsToPersist.length > 0 ? attachmentsToPersist : undefined,
                recipients,
                linkedFormId: linkedFormId || undefined,
              };
              if (linkedFormId) {
                forms.updateData(prevForms => {
                  const list = Array.isArray(prevForms) ? prevForms : [];
                  return list.map(form =>
                    form.id === linkedFormId
                      ? { ...form, linkedAnnouncementId: announcementId }
                      : form
                  );
                });
              }
              return [newItem, ...list];
            });
            break;
          }
        case 'calendar': {
          events.updateData(prev => {
            const list = Array.isArray(prev) ? prev : [];
            const parsedDate = result.date ? new Date(result.date) : new Date();
            const hasTime =
              typeof result?.hasTime === 'boolean' ? result.hasTime : true;
            const savedCalendarTitle = deriveShortFieldFromDraft(
              finalDraft || formatDraft('calendar', result),
              task.prompt,
              'Event',
              80
            );
            const newItem = {
              id: `${Date.now()}`,
              title: savedCalendarTitle,
              description: result.description ?? '',
              date: Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
              location: result.location ?? '',
              hasTime,
              points: 0,
              rsvpRequired: false,
              read: false,
            };
            return [...list, newItem];
          });
          break;
        }
        case 'messages': {
          if (!user?.email) break;
          const recipient = typeof result?.recipient === 'string' ? result.recipient : '';
          if (!recipient) throw new Error('Missing message recipient.');
          const target = resolveMessageTarget(recipient, result?.recipientType);
          if (!target) {
            throw new Error(`Could not find a chat for "${recipient}".`);
          }
          if (target.kind === 'dm' && target.email === user.email) {
            const assistantMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              sender: 'assistant',
              text: "I can't send a message to yourself. Who should I message instead?",

              startedAt: Date.now(),

            };
            setMessages(prev => [...prev, assistantMessage]);
            activeAutoscrollMessageIdRef.current = assistantMessage.id;
            autoscrollDisabledForMessageRef.current.delete(assistantMessage.id);
            throw new Error('You cannot send a message to yourself.');
          }
          const messageText =
            finalDraft ||
            (typeof result?.text === 'string' ? result.text.trim() : '');
          if (!messageText) {
            throw new Error('Missing message text.');
          }
          const newMessage = {
            sender: user.email,
            text: messageText,
            timestamp: new Date().toISOString(),
            readBy: [user.email],
          };
          if (target.kind === 'dm') {
            const convoId = getConversationId(user.email, target.email);
            messagesData.updateData(prev => ({
              ...(prev || {}),
              [convoId]: [...((prev || {})[convoId] || []), newMessage],
            }));
          } else {
            groupChats.updateData(prev => {
              const list = Array.isArray(prev) ? prev : [];
              return list.map(chat =>
                chat.id === target.id
                  ? { ...chat, messages: [...chat.messages, newMessage] }
                  : chat
              );
            });
          }
          break;
        }
        case 'gallery': {
          if (!user) break;
          const attachments = Array.isArray(task.attachments) ? task.attachments : [];
          const imageAttachments = attachments.filter(att =>
            (att.type || '').toLowerCase().startsWith('image/')
          );
          if (imageAttachments.length === 0) {
            throw new Error('Please attach at least one image for the gallery.');
          }
          const description =
            finalDraft ||
            (typeof result?.description === 'string' ? result.description.trim() : '');
          const altText = description || 'Gallery image';
          const lastId =
            Array.isArray(galleryImages.data) && galleryImages.data.length > 0
              ? Math.max(...galleryImages.data.map(item => item.id))
              : 0;
          const newImages: GalleryImage[] = imageAttachments.map((image, index) => ({
            id: lastId + index + 1,
            src: image.dataUri,
            alt: altText,
            author: user.name || 'AI Assistant',
            date: new Date().toLocaleDateString(),
            likes: 0,
            likedBy: [],
            status: 'approved',
            read: false,
          }));
          galleryImages.updateData(prev => {
            const list = Array.isArray(prev) ? prev : [];
            return [...newImages, ...list];
          });
          break;
        }
        case 'form': {
            const title = deriveShortFieldFromDraft(
              finalDraft || formatDraft('form', result),
              task.prompt,
              'New Form',
              80
            );
          const description =
            typeof result?.description === 'string' && result.description.trim()
              ? result.description.trim()
              : undefined;
          const questions = normalizeFormQuestions(result?.questions);
            const newForm: ClubForm = {
              id: crypto.randomUUID(),
              title,
              description,
              questions,
              createdAt: new Date().toISOString(),
              createdBy: authorEmail || 'AI Assistant',
              viewedBy: authorEmail ? [authorEmail] : [],
              responses: [],
            };
            setRecentForms(prev => {
              const next = [
                { id: newForm.id, title: newForm.title, description: newForm.description, createdAt: newForm.createdAt },
                ...prev.filter(form => form.id !== newForm.id),
              ];
              return next.slice(0, RECENT_FORMS_LIMIT);
            });
            setFormTaskIdMap(prev => ({ ...prev, [task.id]: newForm.id }));
            forms.updateData(prev => {
              const list = Array.isArray(prev) ? prev : [];
              return [newForm, ...list];
            });
            break;
          }
        case 'transaction': {
          transactions.updateData(prev => {
            const list = Array.isArray(prev) ? prev : [];
            const savedTransactionDescription = deriveShortFieldFromDraft(
              finalDraft || formatDraft('transaction', result),
              task.prompt,
              'Transaction',
              100
            );
            const newItem = {

              id: `${Date.now()}`,

              description: savedTransactionDescription,

              amount: Number(result.amount ?? 0),

              date: result.date ?? new Date().toISOString(),

              status: result.status ?? 'Paid',

            };

            return [...list, newItem];

          });

          break;

        }

        default:

          break;

      }

    };



  const extractEmailFields = (

      result: any,

      draftText: string | undefined

    ): { subject: string; body: string } | null => {

      const subjectFromResult =

        typeof result?.subject === 'string' ? result.subject.trim() : '';

      const bodyFromResult = typeof result?.body === 'string' ? result.body.trim() : '';

      if (subjectFromResult && bodyFromResult) {

        return { subject: subjectFromResult, body: bodyFromResult };

      }



      const draft = (draftText ?? '').trim();

      if (!draft) return null;



      const subjectMatch = draft.match(/^Subject:\s*(.+)$/im);

      if (subjectMatch) {

        const subject = subjectMatch[1].trim();

        const afterSubject = draft.slice(subjectMatch.index! + subjectMatch[0].length);

        const body = afterSubject.replace(/^\s*\n+/, '').trim();

        if (subject && body) return { subject, body };

      }



      const lines = draft.split(/\r?\n/);

      const firstLine = (lines[0] ?? '').trim();

      const body = lines.slice(1).join('\n').trim();

      if (firstLine && body) return { subject: firstLine, body };



      return null;

    };

    const parseLabeledDraft = (draftText: string) => {
      const lines = draftText.split(/\r?\n/);
      const values: Record<string, string> = {};
      let currentLabel: string | null = null;
      const detailLines: string[] = [];

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
        if (match) {
          currentLabel = match[1].trim().toLowerCase();
          values[currentLabel] = (match[2] ?? '').trim();
          continue;
        }
        if (currentLabel && values[currentLabel] !== undefined && values[currentLabel].length === 0 && line.trim()) {
          values[currentLabel] = line.trim();
          continue;
        }
        if (currentLabel === 'details') {
          detailLines.push(line);
        }
      }

      if (detailLines.length > 0) {
        values.details = detailLines.join('\n').trim();
      }

      return values;
    };

    const isInstructionLikeAnnouncementTitle = (value?: string | null) => {
      const text = String(value ?? '').trim().toLowerCase();
      if (!text) return true;
      return /^(send|write|draft|create|post)\b/.test(text) || /\bannouncement\b/.test(text);
    };

    const deriveShortFieldFromDraft = (
      draftText: string,
      promptText: string | undefined,
      fallback: string,
      maxLength = 80
    ) => {
      const firstNonEmptyLine =
        draftText
          .split(/\r?\n/)
          .map(line => line.trim())
          .find(Boolean) ?? '';
      const cleanedLine = firstNonEmptyLine
        .replace(/^[A-Za-z ]+:\s*/i, '')
        .replace(/[.!?]+$/, '')
        .trim();
      const fallbackText = startCase(cleanTaskIntent(promptText ?? '')).slice(0, maxLength);
      const value = cleanedLine || fallbackText || fallback;
      return value.length > maxLength ? `${value.slice(0, maxLength - 3).trimEnd()}...` : value;
    };

    const parseDraftToResult = (task: PlannedTask, draftText: string): any | null => {
      const draft = draftText.trim();
      if (!draft) return null;

      switch (task.type) {
        case 'announcement':
          return {
            title:
              typeof task.title === 'string' && task.title.trim()
                ? task.title.trim()
                : deriveAnnouncementTitle(draft, task.prompt),
            announcement: draft,
          };
        case 'email': {
          const emailFields = extractEmailFields(null, draft);
          return emailFields ? emailFields : null;
        }
        case 'messages': {
          const localMessageDraft =
            buildLocalMessageDraft({ ...task, draft }) ??
            (task.draftResult ? task.draftResult : null);
          if (!localMessageDraft) return null;
          return {
            recipient: localMessageDraft.recipient,
            recipientType: localMessageDraft.recipientType,
            text: draft,
          };
        }
        case 'gallery':
          return { description: draft };
        case 'transaction': {
          const values = parseLabeledDraft(draft);
          const description =
            values.description ||
            deriveShortFieldFromDraft(draft, task.prompt, 'Transaction', 100);
          const amountText = values.amount || '';
          const numericAmount = Number(amountText.replace(/[^0-9.-]/g, ''));
          return {
            description,
            amount: Number.isFinite(numericAmount) ? numericAmount : amountText,
            date: values.date || new Date().toISOString(),
            status: values.status || 'completed',
          };
        }
        case 'calendar': {
          const values = parseLabeledDraft(draft);
          const title =
            values.title || deriveShortFieldFromDraft(draft, task.prompt, 'Event', 80);
          const dateText = values.date || '';
          const timeText = values.time || '';
          const combinedDate = [dateText, timeText && timeText.toLowerCase() !== 'na' ? timeText : '']
            .filter(Boolean)
            .join(' ')
            .trim();
          const parsedDate = combinedDate ? new Date(combinedDate) : new Date(dateText);
          return {
            title,
            date:
              !Number.isNaN(parsedDate.getTime()) && (dateText || timeText)
                ? parsedDate.toISOString()
                : new Date().toISOString(),
            location: values.location && values.location.toLowerCase() !== 'na' ? values.location : '',
            description: values.details || '',
            hasTime: Boolean(timeText && timeText.toLowerCase() !== 'na'),
          };
        }
        case 'form': {
          const lines = draft.split(/\r?\n/);
          const titleLine = lines.find(line => /^Title:\s*/i.test(line));
          const descriptionLine = lines.find(line => /^Description:\s*/i.test(line));
          const questionLines = lines.filter(line => /^\d+\.\s+/.test(line.trim()));
          const questions = questionLines.map((line: string) => {
            const text = line.trim().replace(/^\d+\.\s+/, '');
            const promptMatch = text.match(/^(.*?)(?:\s+\(([^)]+)\))?(?:\s+\[([^\]]+)\])?$/);
            const prompt = (promptMatch?.[1] ?? text).trim();
            const kind = (promptMatch?.[2] ?? 'shortText').trim();
            const options = (promptMatch?.[3] ?? '')
              .split(',')
              .map(item => item.trim())
              .filter(Boolean);
            return {
              prompt,
              kind,
              required: true,
              options: options.length > 0 ? options : undefined,
            };
          });
          return {
            title:
              titleLine?.replace(/^Title:\s*/i, '').trim() ||
              deriveShortFieldFromDraft(draft, task.prompt, 'Form', 80),
            description: descriptionLine?.replace(/^Description:\s*/i, '').trim() || '',
            questions,
          };
        }
        case 'other':
          return { message: draft };
        default:
          return null;
      }
    };



      try {
        const shouldUseDraftResult =
          task.draftResult &&
          (!task.draft || task.draft === task.draftSource);
        let resultData = shouldUseDraftResult ? task.draftResult : null;
        if (!resultData && finalDraft) {
          resultData = parseDraftToResult(task, finalDraft);
        }
        if (!resultData) {
          updatePlanTask(planId, task.id, t => ({
            ...t,
            status: 'error',
            error: 'Could not send this draft as-is. Refresh the draft or edit it into a supported format.',
          }));
          toast({
            title: 'Task failed',
            description: 'Could not send this draft as-is. Refresh the draft or edit it into a supported format.',
            variant: 'destructive',
          });
          return;
        }
        const sentDraft = finalDraft || task.draftSource || '';
        const formattedResult = formatDraft(task.type, resultData);
        const nextDraft = finalDraft || formattedResult;
        updatePlanTask(planId, task.id, t => ({
          ...t,
          status: 'sent',
          result: resultData,
          error: undefined,
          lastSentDraft: sentDraft || formattedResult,
          draft: nextDraft,
          draftSource: t.draftSource || formattedResult,
        }));
        persistResult(task.type, resultData);

        const viewPath = getRouteForTaskType(task.type);



      if (task.type === 'email') {

        toast({

          title: 'Email ready',

          description: 'Redirecting you to the Email tab...',

        });

        const emailFields = extractEmailFields(resultData, finalDraft);

        if (emailFields) {

          const params = new URLSearchParams({

            subject: emailFields.subject,

            body: emailFields.body,

          });

          router.push(`/email?${params.toString()}`);

        } else {

          router.push(getRouteForTaskType('email'));

        }

      } else {

        toast({

          title: 'Task sent',

          description: `Completed ${task.type} task.`,

          action: (

            <ToastAction altText="View" onClick={() => router.push(viewPath)}>

              View

            </ToastAction>

          ),

        });

      }

    } catch (error: any) {

      console.error(`Assistant task ${task.id} error:`, error);

      updatePlanTask(planId, task.id, t => ({

        ...t,

        status: 'error',

        error: error?.message ?? 'Failed to run task.',

      }));

      toast({

        title: 'Task failed',

        description: error?.message ?? 'Could not run this task.',

        variant: 'destructive',

      });

    } finally {

      setSendingId(null);

    }

  };



  return (

    <div className="h-[calc(100vh-80px)] flex flex-col gap-4">

      <header className="flex items-center gap-3">

        <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">

          <Bot className="h-5 w-5" />

        </div>

        <div>

          <h1 className="text-lg font-semibold leading-none">{appBrandName} AI Assistant</h1>

          <p className="text-sm text-muted-foreground">

            Chat with the assistant to plan tasks. You can review, clarify, edit, and send each item.

          </p>

        </div>

        </header>



      <div className="flex-1 overflow-hidden border rounded-lg bg-card shadow-sm">

<ScrollArea ref={scrollAreaRef} className="h-full">

          <div className="p-4 space-y-4">

            {messages.map(message => {

              const isUser = message.sender === 'user';

              return (

                <div

                  key={message.id}

                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}

                >

                  <div

                    className={`max-w-[840px] rounded-2xl px-4 py-3 ${

                      isUser

                        ? 'bg-primary text-primary-foreground ml-12'

                        : 'bg-muted mr-12 text-foreground'

                    }`}

                  >

                    {message.sender === 'user' && (
                      <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                    )}

                    {isAssistantTextMessage(message) && (
                      <p className="text-sm whitespace-pre-wrap">
                        {message.startedAt
                          ? typewriterChars({
                              text: formatAssistantTextForDisplay(message.text),
                              startAt: message.startedAt,
                              now,
                              charDelayMs: 14,
                            })
                          : formatAssistantTextForDisplay(message.text)}
                      </p>
                    )}

                    {isPlanMessage(message) && (
                      <div className="space-y-3">
                        {(() => {
                          const { tasksStartAt } = getMessageAnimationTimings({
                            startedAt: message.plan.startedAt,
                            summary: message.plan.summary,
                          });

                          return (
                            <>
                              <div className="space-y-3">
                          {(() => {
                            return message.plan.tasks.map((task, index) => {
                              if (tasksStartAt && now < tasksStartAt + index * 200) {
                                return null;
                              }
                              const shouldRefreshDraft = !!task.draft?.trim();
                              const draftButtonLabel = shouldRefreshDraft ? 'Refresh draft' : 'Generate draft';
                              const isGenerateDraft = !shouldRefreshDraft;
                              const DraftButtonIcon = isGenerateDraft ? null : RefreshCw;
                              const draftButtonVariant = isGenerateDraft ? 'default' : 'ghost';
                              const draftButtonClassName = isGenerateDraft ? AI_SPARKLE : '';

                              const taskTitleText = getTaskTitleText(task.type);
                              const { taskBaseStartAt, draftSectionStartAt } = getTaskAnimationTimings({
                                tasksStartAt,
                                index,
                                taskTitleText,
                                question: '',
                                hasFollowUp: false,
                              });
                              const draftSectionVisible = !draftSectionStartAt || now >= draftSectionStartAt;
                              const currentDraftValue = (task.draft ?? '').trim();
                              const lastSentDraft = (task.lastSentDraft ?? '').trim();
                              const canResend =
                                task.status === 'sent' &&
                                currentDraftValue.length > 0 &&
                                currentDraftValue !== lastSentDraft;

                              const typedDraftValue = (() => {
                                if (!task.draftTyping) return null;
                                const perCharMs = 14;
                                const effectiveStartAt = draftSectionStartAt
                                  ? Math.max(task.draftTyping.startedAt, draftSectionStartAt)
                                  : task.draftTyping.startedAt;
                                return typewriterChars({
                                  text: task.draftTyping.fullText,
                                  startAt: effectiveStartAt,
                                  now,
                                  charDelayMs: perCharMs,
                                });
                              })();

                              const draftDisplayValue =
                                typedDraftValue ??
                                (task.isDrafting
                                  ? typewriterChars({
                                      text: 'Generating draft...',
                                      startAt: task.draftingStartedAt,
                                      now,
                                      charDelayMs: 24,
                                    })
                                  : task.draft ?? '');

                              return (
                            <div
                              key={task.id}
                              className="rounded-lg border border-dashed bg-background/80 p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold capitalize">
                                  <TypewriterText
                                    text={taskTitleText}
                                    startAt={taskBaseStartAt}
                                    now={now}
                                    wordDelayMs={40}
                                  />
                                </div>
                                {task.status === 'sent' && (
                                  <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                                    <CheckCircle2 className="h-4 w-4" /> Sent
                                  </span>
                                )}
                                {task.status === 'error' && (
                                  <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium">
                                    <AlertCircle className="h-4 w-4" /> Needs retry
                                  </span>
                                )}
                              </div>

                              {draftSectionVisible && task.type !== 'other' ? (
                                <div className="mt-3 space-y-1">
                                  <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    <TypewriterText
                                      text={
                                        task.type === 'form'
                                          ? 'Form Details'
                                          : task.type === 'calendar'
                                            ? 'Event Details (Editable)'
                                            : 'Draft (Editable)'
                                      }
                                      startAt={draftSectionStartAt}
                                      now={now}
                                      wordDelayMs={40}
                                    />
                                  </label>
                                  {task.type === 'announcement' ? (
                                    <Input
                                      value={task.title ?? ''}
                                      onChange={e =>
                                        updatePlanTask(message.id, task.id, t => ({
                                          ...t,
                                          title: e.target.value,
                                          draftResult:
                                            t.draftResult && typeof t.draftResult === 'object'
                                              ? { ...t.draftResult, title: e.target.value }
                                              : t.draftResult,
                                        }))
                                      }
                                      placeholder="Announcement title"
                                      className="text-sm"
                                      disabled={task.isDrafting || Boolean(task.draftTyping)}
                                    />
                                  ) : null}
                                  <Textarea
                                    value={draftDisplayValue}
                                    onChange={e =>
                                      updatePlanTask(message.id, task.id, t => ({
                                        ...t,
                                        draft: e.target.value,
                                      }))
                                    }
                                    placeholder={task.isDrafting ? 'Generating draft...' : 'Draft will appear here'}
                                    className="min-h-[120px] text-sm"
                                    disabled={task.isDrafting || Boolean(task.draftTyping)}
                                  />
                                </div>
                              ) : null}
                              {draftSectionVisible && task.type === 'announcement' ? (
                                <div className="mt-3 rounded border bg-muted/40 p-3 space-y-2">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Recipients
                                  </div>
                                  {(() => {
                                    const memberList = Array.isArray(members.data)
                                      ? members.data
                                      : [];
                                    const allEmails = memberList.map(member => member.email);
                                    const rawRecipients = Array.isArray(task.recipients)
                                      ? task.recipients
                                      : allEmails;
                                    const validRecipients = rawRecipients.filter(email =>
                                      allEmails.includes(email)
                                    );
                                    const currentRecipients =
                                      validRecipients.length > 0 ? validRecipients : allEmails;
                                    const remainingMembers = memberList.filter(
                                      member => !currentRecipients.includes(member.email)
                                    );
                                    const addPeopleOpen = Boolean(showAddPeople[task.id]);
                                    return (
                                      <>
                                        {currentRecipients.length > 0 ? (
                                          <div className="space-y-1">
                                            {currentRecipients.map(email => (
                                              <div
                                                key={email}
                                                className="flex items-center justify-between rounded border bg-background px-2 py-1 text-xs"
                                              >
                                                <span>{resolveMemberName(email)}</span>
                                                {allEmails.length > 0 && (
                                                  <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6"
                                                    onClick={() =>
                                                      updatePlanTask(message.id, task.id, t => ({
                                                        ...t,
                                                        recipients: currentRecipients.filter(
                                                          item => item !== email
                                                        ),
                                                      }))
                                                    }
                                                  >
                                                    <X className="h-3 w-3" />
                                                  </Button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="text-xs text-muted-foreground">
                                            No recipients selected.
                                          </div>
                                        )}
                                        <details className="pt-2">
                                          <summary className="cursor-pointer text-xs font-medium">
                                            Add People
                                          </summary>
                                          <div className="pt-2 space-y-1">
                                            {remainingMembers.length > 0 ? (
                                              remainingMembers.map(member => (
                                                <div
                                                  key={member.email}
                                                  className="flex items-center justify-between rounded border bg-background px-2 py-1 text-xs"
                                                >
                                                  <span>{member.name}</span>
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                      updatePlanTask(message.id, task.id, t => {
                                                        const existing = Array.isArray(t.recipients)
                                                          ? t.recipients
                                                          : currentRecipients;
                                                        if (existing.includes(member.email)) {
                                                          return t;
                                                        }
                                                        return {
                                                          ...t,
                                                          recipients: [...existing, member.email],
                                                        };
                                                      })
                                                    }
                                                  >
                                                    Add
                                                  </Button>
                                                </div>
                                              ))
                                            ) : (
                                              <div className="text-xs text-muted-foreground">
                                                No more recipients left.
                                              </div>
                                            )}
                                          </div>
                                        </details>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : null}

                              {draftSectionVisible && task.type === 'other' ? (
                                <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">
                                  {task.prompt}
                                </p>
                              ) : null}

                              {task.isDrafting && (
                                <div className="mt-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <TypewriterText
                                    text="Generating draft..."
                                    startAt={task.draftingStartedAt}
                                    now={now}
                                    wordDelayMs={40}
                                  />
                                </div>
                              )}

                              {task.draftError && (
                                <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded flex items-center justify-between gap-2">
                                  <span>{task.draftError}</span>
                                  <Button
                                    size="sm"
                                    variant={draftButtonVariant}
                                    className={`h-7 px-2 ${draftButtonClassName}`}
                                    onClick={() => requestDraftGeneration(message.id, task)}
                                  >
                                    {DraftButtonIcon ? <DraftButtonIcon className="h-3 w-3 mr-1" /> : null}
                                    {draftButtonLabel}
                                  </Button>
                                </div>
                              )}

                              {task.error && (
                                <div className="mt-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
                                  {task.error}
                                </div>
                              )}

                              {draftSectionVisible ? (
                                <div className="mt-3 flex items-center justify-between">
                                  {task.type !== 'other' ? (
                                    <Button
                                      variant={draftButtonVariant}
                                      size="sm"
                                      className={`h-8 px-2 text-xs ${draftButtonClassName}`}
                                      onClick={() => requestDraftGeneration(message.id, task)}
                                      disabled={task.isDrafting}
                                    >
                                      {DraftButtonIcon ? <DraftButtonIcon className="h-3 w-3 mr-2" /> : null}
                                      {draftButtonLabel}
                                    </Button>
                                  ) : (
                                    <span />
                                  )}
                                  {task.type !== 'other' ? (
                                    <Button
                                      size="sm"
                                      onClick={() => runTask(message.id, task)}
                                      disabled={
                                        sendingId === task.id ||
                                        (task.status === 'sent' && !canResend)
                                      }
                                    >
                                      {sendingId === task.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        canResend
                                          ? 'Resend'
                                          : task.type === 'form'
                                            ? 'Generate and Send'
                                            : task.type === 'calendar'
                                              ? 'Generate and Send'
                                              : 'Send'
                                      )}
                                    </Button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      Not supported
                                    </span>
                                  )}
                                </div>
                              ) : null}

                              {task.result && (
                                <div className="mt-2 bg-muted/50 p-2 rounded text-xs">
                                  <div className="font-semibold">Result</div>
                                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
                                    {formatDraft(task.type, task.result)}
                                  </pre>
                                </div>
                              )}
                            </div>
                              );
                            });
                          })()}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                    {isFollowUpMessage(message) && (
                      <div className="space-y-2">
                        {message.followUp.questions.length > 1 ? (
                          <>
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <MessageSquare className="h-4 w-4" />
                              <span>{FOLLOWUP_HEADER_TEXT}</span>
                            </div>
                            <ol className="ml-5 list-decimal text-sm text-muted-foreground space-y-1">
                              {message.followUp.questions.map((question, idx) => (
                                <li key={`${message.id}-${idx}`}>
                                  {question}
                                </li>
                              ))}
                            </ol>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MessageSquare className="h-4 w-4 text-foreground" />
                            <span>
                              {formatSingleFollowUpText(message.followUp.questions[0] || '')}
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Reply in the chat box with your answers in any format.
                        </p>
                      </div>
                    )}
                  </div>

                </div>

              );

            })}

            <div ref={bottomRef} />

          </div>

        </ScrollArea>

      </div>



      <div className="border rounded-lg bg-card shadow-sm">

        <form

          onSubmit={form.handleSubmit(handleSubmit)}

          className="p-3 space-y-2"

        >

          <div className="flex items-center gap-3">
            <Input
              {...form.register('query')}
              placeholder="Tell the assistant what to do (announcements, forms, calendar, email, messages...)"
              autoComplete="off"
              disabled={isPlanning || Boolean(aiBlockedReason)}
            />
            <Button
              type="submit"
              disabled={isPlanning || Boolean(aiBlockedReason)}
              className={AI_SPARKLE}
            >
              {isPlanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Planning...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" /> Send
                </>
              )}
            </Button>
          </div>
          {aiBlockedReason && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {aiBlockedReason === 'limit'
                ? 'Daily limit reached. Try again tomorrow or ask an admin to upgrade your plan.'
                : 'Billing issue detected. Ask an admin to update the subscription.'}
            </div>
          )}

        </form>

      </div>

      <AlertDialog
        open={Boolean(draftRegenerationRequest)}
        onOpenChange={open => {
          if (!open) {
            setDraftRegenerationRequest(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Regenerating this draft will use 1 more AI request for today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (draftRegenerationRequest) {
                  void generateDraft(
                    draftRegenerationRequest.planId,
                    draftRegenerationRequest.task
                  );
                }
                setDraftRegenerationRequest(null);
              }}
            >
              Regenerate draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>

  );

}

type AssistantRouteErrorBoundaryProps = {
  children: React.ReactNode;
};

type AssistantRouteErrorBoundaryState = {
  hasError: boolean;
  retryKey: number;
};

class AssistantRouteErrorBoundary extends React.Component<
  AssistantRouteErrorBoundaryProps,
  AssistantRouteErrorBoundaryState
> {
  private hasAutoRetried = false;

  constructor(props: AssistantRouteErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      retryKey: 0,
    };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Assistant route boundary', error);
    if (!this.hasAutoRetried) {
      this.hasAutoRetried = true;
      window.setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          retryKey: prev.retryKey + 1,
        }));
      }, 0);
    }
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      retryKey: prev.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            Please try again. If the issue persists, restart the app.
          </p>
          <Button onClick={this.handleRetry}>Try again</Button>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

export default function AssistantPage() {
  return (
    <Suspense fallback={<div>Loading assistant...</div>}>
      <AssistantRouteErrorBoundary>
        <AssistantPageInner />
      </AssistantRouteErrorBoundary>
    </Suspense>
  );
}

