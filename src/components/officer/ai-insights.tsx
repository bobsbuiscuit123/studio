'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  Lightbulb,
  TrendingDown,
  Wallet,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getOfficerInsights } from '@/lib/analytics/officerInsights';
import type { OfficerInsights } from '@/lib/analytics/officerInsights';
import { getMemberInsights } from '@/lib/analytics/memberInsights';
import { openAssistantWithContext } from '@/lib/assistant/prefill';
import {
  useAnnouncements,
  useCurrentUser,
  useEvents,
  useForms,
  useGroupChats,
  useMembers,
  useMessages,
  notifyOrgAiUsageChanged,
  useTransactions,
} from '@/lib/data-hooks';
import { resolveInsightRequestAction } from '@/app/(app)/assistant/actions';
import { useGroupUserStateSection } from '@/lib/group-user-state';

type InsightListKey = 'action' | 'engagement' | 'finance';
type InsightBoxKey = InsightListKey | string;

type InsightItem = {
  id?: string;
  text: string;
  actionLabel?: string;
  actionHref?: string;
  contextText?: string;
  createdAt?: number;
  source?: 'generated' | 'custom';
};

type CustomInsightRequest = {
  id: string;
  listKey: InsightBoxKey;
  prompt: string;
};

type HiddenInsight = {
  id: string;
  text: string;
};

type CustomInsightBox = {
  id: string;
  title: string;
};

type HiddenInsightBox = {
  id: string;
  title: string;
};

type InsightResolutionCache = {
  contextVersion: string;
  text?: string;
  actionLabel?: string;
  actionHref?: string | null;
  contextText?: string;
  status?: string;
  missingInfo?: string;
};

type InsightResolutionResult = {
  status?: string;
  text?: string;
  actionLabel?: string;
  actionHref?: string | null;
  contextText?: string;
  missingInfo?: string;
};

const INSIGHT_ACTION_TIMEOUT_MS = 15_000;

type AiInsightsStoredState = {
  customRequests: CustomInsightRequest[];
  hiddenInsights: Record<string, HiddenInsight[]>;
  customBoxes: CustomInsightBox[];
  hiddenBoxes: HiddenInsightBox[];
  promptCache: Record<string, InsightResolutionCache>;
  requestCache: Record<string, InsightResolutionCache>;
};

const DEFAULT_AI_INSIGHTS_STATE: AiInsightsStoredState = {
  customRequests: [],
  hiddenInsights: { action: [], engagement: [], finance: [] },
  customBoxes: [],
  hiddenBoxes: [],
  promptCache: {},
  requestCache: {},
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
};

const areAiInsightStatesEqual = (
  left: AiInsightsStoredState,
  right: AiInsightsStoredState
) => stableSerialize(left) === stableSerialize(right);

const MAX_ITEMS = 3;

const typewriterText = ({
  text,
  startAt,
  now,
  charDelayMs = 18,
}: {
  text: string;
  startAt: number;
  now: number;
  charDelayMs?: number;
}) => {
  if (!startAt) return text;
  const elapsed = Math.max(0, now - startAt);
  const visibleCount = Math.min(text.length, Math.floor(elapsed / charDelayMs) + 1);
  return text.slice(0, visibleCount);
};

const InsightList = ({
  listKey,
  title,
  icon: Icon,
  items,
  expanded,
  onToggleExpand,
  emptyLabel,
  editMode,
  hiddenItems,
  onClearHidden,
  onRemoveItem,
  onHideBox,
  generatedAt,
  now,
  shouldAnimate,
  animationDelayMs,
}: {
  listKey: InsightBoxKey;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: InsightItem[];
  expanded: boolean;
  onToggleExpand: () => void;
  emptyLabel: string;
  editMode: boolean;
  hiddenItems: HiddenInsight[];
  onClearHidden: () => void;
  onRemoveItem: (item: InsightItem) => void;
  onHideBox?: () => void;
  generatedAt: number;
  now: number;
  shouldAnimate: boolean;
  animationDelayMs?: number;
}) => {
  const visibleItems = expanded ? items : items.slice(0, MAX_ITEMS);
  const defaultReviewHref: Record<InsightListKey, string> = {
    action: '/calendar',
    engagement: '/announcements',
    finance: '/finances',
  };
  const fallbackReviewHref =
    listKey === 'action' || listKey === 'engagement' || listKey === 'finance'
      ? defaultReviewHref[listKey]
      : undefined;
  return (
    <div
      className="rounded-lg border bg-background p-3"
      style={
        generatedAt
          ? {
              animation: `insightBoxIn 320ms ease-out both`,
              animationDelay: animationDelayMs ? `${animationDelayMs}ms` : undefined,
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {items.length > MAX_ITEMS && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={onToggleExpand}
            >
              {expanded ? 'View less' : 'View all'}
            </Button>
          )}
          {editMode && onHideBox ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onHideBox}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {visibleItems.map((item, idx) => (
            <div key={`${item.text}-${idx}`} className="flex items-start gap-2 text-sm">
              <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="flex-1 space-y-1">
                <p>
                  {shouldAnimate && (item.createdAt || generatedAt)
                    ? typewriterText({
                        text: item.text,
                        startAt: item.createdAt ?? generatedAt + idx * 120,
                        now,
                      })
                    : item.text}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <Link
                    className="text-primary hover:underline"
                    href={item.actionHref ?? fallbackReviewHref ?? '/dashboard'}
                  >
                    Review
                  </Link>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => openAssistantWithContext(item.contextText ?? item.text)}
                  >
                    Fix
                  </button>
                  {editMode ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-red-500 hover:text-red-600"
                      onClick={() => onRemoveItem(item)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editMode && hiddenItems.length > 0 ? (
        <div className="mt-3 border-t pt-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-muted-foreground">Hidden</div>
            <Button size="sm" variant="ghost" onClick={onClearHidden}>
              Clear hidden
            </Button>
          </div>
          <div className="mt-2 space-y-1 text-xs">
            {hiddenItems.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{item.text}</span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => onRemoveItem({ id: item.id, text: item.text })}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default function AIInsights({
  clubId,
  userId,
  mode = 'officer',
}: {
  clubId?: string | null;
  userId?: string | null;
  mode?: 'officer' | 'member';
}) {
  const announcements = useAnnouncements();
  const events = useEvents();
  const transactions = useTransactions();
  const members = useMembers();
  const forms = useForms();
  const messages = useMessages();
  const groupChats = useGroupChats();
  const { user } = useCurrentUser();
  const [editMode, setEditMode] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    action: false,
    engagement: false,
    finance: false,
  });
  const [hiddenInsights, setHiddenInsights] = useState<Record<string, HiddenInsight[]>>({
    action: [],
    engagement: [],
    finance: [],
  });
  const [customRequests, setCustomRequests] = useState<CustomInsightRequest[]>([]);
  const [customInsights, setCustomInsights] = useState<Record<string, InsightItem[]>>({
    action: [],
    engagement: [],
    finance: [],
  });
  const [customBoxes, setCustomBoxes] = useState<CustomInsightBox[]>([]);
  const [hiddenBoxes, setHiddenBoxes] = useState<HiddenInsightBox[]>([]);
  const [customHydrated, setCustomHydrated] = useState(false);
  const [boxesHydrated, setBoxesHydrated] = useState(false);
  const [hiddenHydrated, setHiddenHydrated] = useState(false);
  const [hiddenBoxesHydrated, setHiddenBoxesHydrated] = useState(false);
  const [newInsightText, setNewInsightText] = useState('');
  const [newInsightList, setNewInsightList] = useState<InsightBoxKey>('action');
  const [newBoxTitle, setNewBoxTitle] = useState('');
  const [generatedAt, setGeneratedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [isResolvingInsight, setIsResolvingInsight] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [isResolvingCustomInsights, setIsResolvingCustomInsights] = useState(false);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const lastSubmittedStateRef = useRef<string>('');
  const [promptCache, setPromptCache] = useState<Record<string, InsightResolutionCache>>({});
  const [requestCache, setRequestCache] = useState<Record<string, InsightResolutionCache>>({});
  const { data: persistedAiState, updateData: updatePersistedAiState, loading: aiStateLoading } =
    useGroupUserStateSection<AiInsightsStoredState>('aiInsights', DEFAULT_AI_INSIGHTS_STATE);

  const storageScope = clubId && user?.email
    ? `${user.email.toLowerCase()}:${clubId}`
    : null;
  const animationStorageKey =
    storageScope
      ? `ai_insights_seen:${storageScope}`
      : null;

  useEffect(() => {
    if (!animationStorageKey || typeof window === 'undefined') {
      setShouldAnimate(false);
      return;
    }
    const seen = sessionStorage.getItem(animationStorageKey);
    if (seen) {
      setShouldAnimate(false);
      return;
    }
    setShouldAnimate(true);
    sessionStorage.setItem(animationStorageKey, '1');
  }, [animationStorageKey]);

  useEffect(() => {
    if (aiStateLoading) return;
    setCustomRequests(Array.isArray(persistedAiState.customRequests) ? persistedAiState.customRequests : []);
    setCustomBoxes(Array.isArray(persistedAiState.customBoxes) ? persistedAiState.customBoxes : []);
    setHiddenBoxes(Array.isArray(persistedAiState.hiddenBoxes) ? persistedAiState.hiddenBoxes : []);
    setHiddenInsights(
      persistedAiState.hiddenInsights && typeof persistedAiState.hiddenInsights === 'object'
        ? persistedAiState.hiddenInsights
        : { action: [], engagement: [], finance: [] }
    );
    setPromptCache(
      persistedAiState.promptCache && typeof persistedAiState.promptCache === 'object'
        ? persistedAiState.promptCache
        : {}
    );
    setRequestCache(
      persistedAiState.requestCache && typeof persistedAiState.requestCache === 'object'
        ? persistedAiState.requestCache
        : {}
    );
    lastSubmittedStateRef.current = stableSerialize({
      customRequests: Array.isArray(persistedAiState.customRequests) ? persistedAiState.customRequests : [],
      hiddenInsights:
        persistedAiState.hiddenInsights && typeof persistedAiState.hiddenInsights === 'object'
          ? persistedAiState.hiddenInsights
          : { action: [], engagement: [], finance: [] },
      customBoxes: Array.isArray(persistedAiState.customBoxes) ? persistedAiState.customBoxes : [],
      hiddenBoxes: Array.isArray(persistedAiState.hiddenBoxes) ? persistedAiState.hiddenBoxes : [],
      promptCache:
        persistedAiState.promptCache && typeof persistedAiState.promptCache === 'object'
          ? persistedAiState.promptCache
          : {},
      requestCache:
        persistedAiState.requestCache && typeof persistedAiState.requestCache === 'object'
          ? persistedAiState.requestCache
          : {},
    });
    setCustomHydrated(true);
    setBoxesHydrated(true);
    setHiddenHydrated(true);
    setHiddenBoxesHydrated(true);
  }, [aiStateLoading, persistedAiState]);

  useEffect(() => {
    if (
      aiStateLoading ||
      !customHydrated ||
      !boxesHydrated ||
      !hiddenHydrated ||
      !hiddenBoxesHydrated
    ) {
      return;
    }
    const nextState: AiInsightsStoredState = {
      customRequests,
      hiddenInsights,
      customBoxes,
      hiddenBoxes,
      promptCache,
      requestCache,
    };
    const serializedNextState = stableSerialize(nextState);
    if (serializedNextState === lastSubmittedStateRef.current) {
      return;
    }
    if (areAiInsightStatesEqual(nextState, persistedAiState)) {
      lastSubmittedStateRef.current = serializedNextState;
      return;
    }
    lastSubmittedStateRef.current = serializedNextState;
    void updatePersistedAiState(nextState);
  }, [
    aiStateLoading,
    boxesHydrated,
    customBoxes,
    customHydrated,
    customRequests,
    hiddenBoxes,
    hiddenBoxesHydrated,
    hiddenHydrated,
    hiddenInsights,
    promptCache,
    persistedAiState,
    requestCache,
    updatePersistedAiState,
  ]);

  const loading =
    announcements.loading ||
    events.loading ||
    transactions.loading ||
    members.loading ||
    forms.loading ||
    messages.loading ||
    groupChats.loading;

  const insights = useMemo(() => {
    if (mode === 'member') {
      return getMemberInsights({
        userId,
        announcements: announcements.data,
        events: events.data,
        members: members.data,
      });
    }
    return getOfficerInsights({
      userId,
      clubId,
      announcements: announcements.data,
      events: events.data,
      transactions: transactions.data,
      members: members.data,
    });
  }, [
    announcements.data,
    clubId,
    events.data,
    members.data,
    mode,
    transactions.data,
    userId,
  ]);

  const insightsContext = useMemo(() => {
    const currentUser = user ? { name: user.name, email: user.email } : undefined;
    const memberList = members.data ?? [];
    const announcementList = announcements.data ?? [];
    const eventList = events.data ?? [];
    const formList = forms.data ?? [];
    const messageMap = messages.data ?? {};
    const groupChatList = groupChats.data ?? [];
    const transactionList = mode === 'member' ? [] : transactions.data ?? [];
    const userEmail = user?.email?.toLowerCase() ?? '';

    const directMessages = Object.values(messageMap).flat();
    const unreadDirect = userEmail
      ? directMessages.filter(
          msg =>
            msg.sender?.toLowerCase?.() !== userEmail &&
            !(msg.readBy ?? []).some(email => email.toLowerCase() === userEmail)
        ).length
      : 0;
    const groupMessages = groupChatList.flatMap(chat => chat.messages ?? []);
    const unreadGroup = userEmail
      ? groupMessages.filter(
          msg =>
            msg.sender?.toLowerCase?.() !== userEmail &&
            !(msg.readBy ?? []).some(email => email.toLowerCase() === userEmail)
        ).length
      : 0;

    const snapshot = {
      currentUser,
      memberCount: memberList.length,
      memberSample: memberList.slice(0, 8).map(member => member.name),
      announcements: announcementList.slice(0, 12).map(item => ({
        id: item.id,
        title: item.title,
        date: item.date,
        read: item.read,
        views: (item.viewedBy ?? []).length,
      })),
      events: eventList.slice(0, 12).map(item => ({
        id: item.id,
        title: item.title,
        date: item.date,
        location: item.location,
        rsvpRequired: Boolean(item.rsvpRequired),
        rsvpCounts: {
          yes: item.rsvps?.yes?.length ?? 0,
          no: item.rsvps?.no?.length ?? 0,
          maybe: item.rsvps?.maybe?.length ?? 0,
        },
        attendeesCount: item.attendees?.length ?? 0,
      })),
      forms: formList.slice(0, 12).map(item => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        responseCount: item.responses?.length ?? 0,
      })),
      messages: {
        directCount: directMessages.length,
        unreadDirect,
        groupCount: groupMessages.length,
        unreadGroup,
      },
      groupChatCount: groupChatList.length,
      transactions: transactionList.slice(0, 12).map(item => ({
        id: item.id,
        description: item.description,
        amount: item.amount,
        date: item.date,
        status: item.status,
      })),
    };

    return JSON.stringify(snapshot);
  }, [
    announcements.data,
    events.data,
    forms.data,
    groupChats.data,
    members.data,
    messages.data,
    transactions.data,
    user,
    mode,
  ]);

  const contextVersion = useMemo(
    () =>
      [
        clubId ?? 'group',
        mode,
        user?.email ?? 'user',
        hashString(insightsContext),
      ].join('|'),
    [clubId, insightsContext, mode, user?.email]
  );

  useEffect(() => {
    if (loading) return;
    if (!shouldAnimate) {
      setGeneratedAt(0);
      return;
    }
    setGeneratedAt(Date.now());
  }, [
    loading,
    clubId,
    userId,
    insights.actionNeeded.length,
    insights.engagementWarnings.length,
    insights.financeRisks.length,
    insights.bestPracticeNudge,
    shouldAnimate,
  ]);

  useEffect(() => {
    if (!generatedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 40);
    return () => clearInterval(interval);
  }, [generatedAt]);

  const getListItems = (key: InsightListKey, baseItems: InsightItem[]) => {
    const hidden = (hiddenInsights[key] ?? []).map(item => item.id);
    const added = customInsights[key] ?? [];
    const filtered: InsightItem[] = baseItems
      .filter(item => {
        if (!item.id) return true;
        return !hidden.includes(item.id);
      })
      .map(item => ({
        ...item,
        createdAt: shouldAnimate ? generatedAt : undefined,
        source: 'generated' as const,
      }));
    return [...filtered, ...added];
  };

  const handleRemoveItem = (key: InsightBoxKey, item: InsightItem) => {
    if (item.source === 'custom' && item.id) {
      setCustomRequests(prev => prev.filter(request => request.id !== item.id));
      return;
    }
    const itemId = item.id;
    if (!itemId) return;
    const currentHidden = hiddenInsights[key] ?? [];
    const isHidden = currentHidden.some(hidden => hidden.id === itemId);
    if (isHidden) {
      setHiddenInsights(prev => ({
        ...prev,
        [key]: (prev[key] ?? []).filter(hidden => hidden.id !== itemId),
      }));
    } else {
      setHiddenInsights(prev => ({
        ...prev,
        [key]: [...(prev[key] ?? []), { id: itemId, text: item.text }],
      }));
    }
  };

  const clearHiddenInsights = (listKey: InsightBoxKey) => {
    setHiddenInsights(prev => ({ ...prev, [listKey]: [] }));
  };

  const getCustomListItems = (key: InsightBoxKey) => {
    const hidden = (hiddenInsights[key] ?? []).map(item => item.id);
    const added = customInsights[key] ?? [];
    return added.filter(item => !item.id || !hidden.includes(item.id));
  };

  const appendCustomInsight = (listKey: InsightBoxKey, item: InsightItem) => {
    setCustomInsights(prev => ({
      ...prev,
      [listKey]: [item, ...(prev[listKey] ?? [])],
    }));
    setExpanded(prev => ({ ...prev, [listKey]: true }));
  };

  useEffect(() => {
    if (mode === 'member' && newInsightList === 'finance') {
      setNewInsightList('action');
    }
  }, [mode, newInsightList]);

  useEffect(() => {
    if (customBoxes.length === 0) return;
    setHiddenInsights(prev => {
      const next = { ...prev };
      customBoxes.forEach(box => {
        if (!next[box.id]) next[box.id] = [];
      });
      return next;
    });
    setCustomInsights(prev => {
      const next = { ...prev };
      customBoxes.forEach(box => {
        if (!next[box.id]) next[box.id] = [];
      });
      return next;
    });
  }, [customBoxes]);

  const inferActionHref = (prompt: string) => {
    const normalized = prompt.toLowerCase();
    if (
      normalized.includes('message') ||
      normalized.includes('messages') ||
      normalized.includes('dm') ||
      normalized.includes('chat') ||
      normalized.includes('reply')
    ) {
      return '/messages';
    }
    if (normalized.includes('form') || normalized.includes('response')) return '/forms';
    if (
      normalized.includes('event') ||
      normalized.includes('calendar') ||
      normalized.includes('rsvp')
    ) {
      return '/calendar';
    }
    if (normalized.includes('announcement')) return '/announcements';
    if (
      normalized.includes('finance') ||
      normalized.includes('expense') ||
      normalized.includes('balance')
    ) {
      return '/finances';
    }
    if (normalized.includes('member')) return '/members';
    return null;
  };

  const resolveLocalInsightRequest = (prompt: string): InsightResolutionResult | null => {
    const normalized = prompt.toLowerCase();
    const transactionList = mode === 'member' ? [] : transactions.data ?? [];
    const userEmail = user?.email?.toLowerCase() ?? '';
    const directMessages = Object.values(messages.data ?? {}).flat();
    const groupMessages = (groupChats.data ?? []).flatMap(chat => chat.messages ?? []);

    if (
      normalized.includes('message') ||
      normalized.includes('messages') ||
      normalized.includes('dm') ||
      normalized.includes('chat') ||
      normalized.includes('reply')
    ) {
      if (!userEmail) {
        return {
          status: 'ok',
          text: 'Not enough data yet.',
        };
      }

      const unreadDirect = directMessages.filter(
        msg =>
          msg.sender?.toLowerCase?.() !== userEmail &&
          !(msg.readBy ?? []).some(email => email.toLowerCase() === userEmail)
      ).length;
      const unreadGroup = groupMessages.filter(
        msg =>
          msg.sender?.toLowerCase?.() !== userEmail &&
          !(msg.readBy ?? []).some(email => email.toLowerCase() === userEmail)
      ).length;
      const unreadTotal = unreadDirect + unreadGroup;

      return {
        status: 'ok',
        text:
          unreadTotal > 0
            ? `You have ${unreadTotal} unread message${unreadTotal === 1 ? '' : 's'}.`
            : 'You are all caught up on messages.',
        actionLabel: 'Review',
        actionHref: '/messages',
        contextText:
          unreadTotal > 0
            ? `You have ${unreadTotal} unread messages. Help me reply to them.`
            : 'I am all caught up on messages. Help me stay on top of replies.',
      };
    }

    if (
      normalized.includes('balance') ||
      normalized.includes('money i have') ||
      normalized.includes('money we have') ||
      normalized.includes('current amount') ||
      normalized.includes('how much money')
    ) {
      const balance = transactionList.reduce(
        (sum, item) => sum + Number(item.amount ?? 0),
        0
      );
      const formattedBalance = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(balance);
      return {
        status: 'ok',
        text: `Current balance is ${formattedBalance}.`,
        actionLabel: 'Review',
        actionHref: '/finances',
        contextText: `Current balance is ${formattedBalance}. Help me review the finances.`,
      };
    }

    return null;
  };

  const handleAddInsight = async () => {
    const trimmed = newInsightText.trim();
    if (!trimmed || isResolvingInsight) return;
    setInsightError(null);
    setIsResolvingInsight(true);
    try {
      const promptKey = `ai_insight_prompt_cache:${contextVersion}:${newInsightList}:${trimmed.toLowerCase()}`;
      const cachedPrompt = promptCache[promptKey];
      const cachedText =
        typeof cachedPrompt?.text === 'string' ? cachedPrompt.text.trim() : '';
      if (cachedText) {
        const requestId = crypto.randomUUID();
        const inferredHref = inferActionHref(trimmed);
        const finalActionHref = cachedPrompt.actionHref ?? inferredHref ?? undefined;
        const finalActionLabel =
          cachedPrompt.actionLabel ?? (finalActionHref ? 'Review' : undefined);
        const resolvedCache = {
          ...cachedPrompt,
          contextVersion,
          actionHref: finalActionHref,
          actionLabel: finalActionLabel,
        };
        setRequestCache(prev => ({
          ...prev,
          [requestId]: resolvedCache,
        }));
        setCustomRequests(prev => [
          ...prev,
          { id: requestId, listKey: newInsightList, prompt: trimmed },
        ]);
        appendCustomInsight(newInsightList, {
          id: requestId,
          text: cachedText,
          actionLabel: finalActionLabel,
          actionHref: finalActionHref,
          contextText: cachedPrompt.contextText,
          createdAt: Date.now(),
          source: 'custom' as const,
        });
        setNewInsightText('');
        return;
      }

      const localResolved = resolveLocalInsightRequest(trimmed);
      const resolvedResult = localResolved
        ? ({ ok: true, data: localResolved } as const)
        : await Promise.race([
            resolveInsightRequestAction(trimmed, insightsContext),
            new Promise<{ ok: false; error: { message: string } }>(resolve =>
              setTimeout(
                () =>
                  resolve({
                    ok: false,
                    error: { message: 'AI took too long to respond. Please try again.' },
                  }),
                INSIGHT_ACTION_TIMEOUT_MS
              )
            ),
          ]);
      if (!resolvedResult.ok) {
        setInsightError(resolvedResult.error.message);
        return;
      }
      if (!localResolved) {
        notifyOrgAiUsageChanged(undefined, 1);
      }
      const resolved = resolvedResult.data as InsightResolutionResult;
      const status = resolved?.status ?? 'ok';
      if (status === 'invalid') {
        setInsightError("That request doesn't make sense as an insight.");
        return;
      }
      if (status === 'needs_info') {
        const missingInfo = resolved?.missingInfo?.trim();
        setInsightError(
          missingInfo
            ? `Please provide ${missingInfo}.`
            : 'Please provide a bit more detail for that insight.'
        );
        return;
      }
      const resolvedText =
        typeof resolved?.text === 'string' ? resolved.text.trim() : '';
      if (!resolvedText) {
        setInsightError('Unable to generate an insight from that request.');
        return;
      }
      const requestId = crypto.randomUUID();
      const inferredHref = inferActionHref(trimmed);
      const finalActionHref = resolved.actionHref ?? inferredHref ?? undefined;
      const finalActionLabel = resolved.actionLabel ?? (finalActionHref ? 'Review' : undefined);
      const resolvedCache = {
        ...resolved,
        contextVersion,
        actionHref: finalActionHref,
        actionLabel: finalActionLabel,
      };
      setPromptCache(prev => ({
        ...prev,
        [promptKey]: resolvedCache,
      }));
      setRequestCache(prev => ({
        ...prev,
        [requestId]: resolvedCache,
      }));
      setCustomRequests(prev => [
        ...prev,
        { id: requestId, listKey: newInsightList, prompt: trimmed },
      ]);
      appendCustomInsight(newInsightList, {
        id: requestId,
        text: resolvedText,
        actionLabel: finalActionLabel,
        actionHref: finalActionHref,
        contextText: resolved.contextText,
        createdAt: Date.now(),
        source: 'custom' as const,
      });
      setNewInsightText('');
    } catch (error) {
      setInsightError('Unable to generate an insight right now.');
    } finally {
      setIsResolvingInsight(false);
    }
  };

  const handleAddBox = () => {
    const trimmed = newBoxTitle.trim();
    if (!trimmed) return;
    const newId = `custom-${crypto.randomUUID()}`;
    const newBox: CustomInsightBox = { id: newId, title: trimmed };
    setCustomBoxes(prev => [...prev, newBox]);
    setHiddenInsights(prev => ({ ...prev, [newId]: [] }));
    setCustomInsights(prev => ({ ...prev, [newId]: [] }));
    setExpanded(prev => ({ ...prev, [newId]: false }));
    setNewInsightList(newId);
    setNewBoxTitle('');
  };

  const baseBoxTitles: Record<InsightListKey, string> = {
    action: 'Action needed',
    engagement: 'Engagement warnings',
    finance: 'Financial risks',
  };

  const hiddenBoxIds = useMemo(() => new Set(hiddenBoxes.map(box => box.id)), [hiddenBoxes]);

  const handleHideBox = (boxId: InsightBoxKey) => {
    if (hiddenBoxIds.has(boxId)) return;
    const title =
      baseBoxTitles[boxId as InsightListKey] ??
      customBoxes.find(box => box.id === boxId)?.title ??
      'Custom insight';
    setHiddenBoxes(prev => [...prev, { id: boxId, title }]);
  };

  const handleRestoreBox = (boxId: InsightBoxKey) => {
    setHiddenBoxes(prev => prev.filter(box => box.id !== boxId));
  };

  const clearHiddenBoxes = () => {
    setHiddenBoxes([]);
  };

  useEffect(() => {
    if (customRequests.length === 0) {
      setCustomInsights(prev => ({
        ...prev,
        action: prev.action ?? [],
        engagement: prev.engagement ?? [],
        finance: prev.finance ?? [],
      }));
      return;
    }
    const next: Record<string, InsightItem[]> = {
      action: [],
      engagement: [],
      finance: [],
    };
    customRequests.forEach(request => {
      const parsed = requestCache[request.id];
      if (!parsed) return;
      if (parsed.contextVersion !== contextVersion) return;
      if (parsed.status === 'invalid' || parsed.status === 'needs_info') return;
      const parsedText = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      if (!parsedText) return;
      const inferredHref = inferActionHref(request.prompt);
      const resolved = {
        ...parsed,
        actionHref: parsed.actionHref ?? inferredHref,
        actionLabel:
          parsed.actionLabel ??
          (parsed.actionHref || inferredHref ? 'Review' : undefined),
      };
      if (!next[request.listKey]) {
        next[request.listKey] = [];
      }
      next[request.listKey].push({
        id: request.id,
        text: parsedText,
        actionLabel: resolved.actionLabel,
            actionHref: resolved.actionHref ?? undefined,
        contextText: resolved.contextText,
        createdAt: Date.now(),
        source: 'custom' as const,
      });
    });
    setCustomInsights(next);
    setIsResolvingCustomInsights(false);
  }, [contextVersion, customRequests, requestCache]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <style jsx>{`
        @keyframes insightBoxIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">AI Insights</CardTitle>
          <p className="text-sm text-muted-foreground">
            Quick signals from recent club activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditMode(prev => !prev)}
          >
            {editMode ? 'Done editing' : 'Edit insights'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {editMode ? (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">Add insight</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={newInsightList}
                onChange={event => setNewInsightList(event.target.value as InsightBoxKey)}
              >
                <option value="action">Action needed</option>
                <option value="engagement">Engagement warnings</option>
                {mode !== 'member' ? (
                  <option value="finance">Financial risks</option>
                ) : null}
                {customBoxes.map(box => (
                  <option key={box.id} value={box.id}>
                    {box.title}
                  </option>
                ))}
              </select>
              <input
                className="flex-1 min-w-[220px] h-9 rounded-md border bg-background px-2 text-sm"
                placeholder="Add a custom insight"
                value={newInsightText}
                onChange={event => setNewInsightText(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  event.stopPropagation();
                  void handleAddInsight();
                }}
                disabled={isResolvingInsight || isResolvingCustomInsights}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleAddInsight}
                disabled={isResolvingInsight || isResolvingCustomInsights}
              >
                {isResolvingInsight ? 'Analyzing...' : 'Add'}
              </Button>
            </div>
            {insightError ? (
              <div className="text-xs text-destructive">{insightError}</div>
            ) : null}
            <div className="pt-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Add insight box
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="flex-1 min-w-[220px] h-9 rounded-md border bg-background px-2 text-sm"
                  placeholder="New box title"
                  value={newBoxTitle}
                  onChange={event => setNewBoxTitle(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    event.stopPropagation();
                    handleAddBox();
                  }}
                />
                <Button type="button" size="sm" onClick={handleAddBox} disabled={!newBoxTitle.trim()}>
                  Add box
                </Button>
              </div>
            </div>
            {hiddenBoxes.length > 0 ? (
              <div className="pt-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Hidden boxes
                  </div>
                  <Button size="sm" variant="ghost" onClick={clearHiddenBoxes}>
                    Clear hidden boxes
                  </Button>
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  {hiddenBoxes.map(box => (
                    <div key={box.id} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{box.title}</span>
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => handleRestoreBox(box.id)}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={`grid gap-4 ${mode === 'member' ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
          {!hiddenBoxIds.has('action') ? (
            <InsightList
              listKey="action"
              title="Action needed"
              icon={BadgeCheck}
              items={getListItems('action', insights.actionNeeded)}
              expanded={expanded.action ?? false}
              onToggleExpand={() =>
                setExpanded(prev => ({ ...prev, action: !prev.action }))
              }
              emptyLabel="Not enough data yet."
              editMode={editMode}
              hiddenItems={hiddenInsights.action}
              onClearHidden={() => clearHiddenInsights('action')}
              onRemoveItem={item => handleRemoveItem('action', item)}
              onHideBox={() => handleHideBox('action')}
              generatedAt={generatedAt}
              now={now}
              shouldAnimate={shouldAnimate}
              animationDelayMs={0}
            />
          ) : null}
          {!hiddenBoxIds.has('engagement') ? (
            <InsightList
              listKey="engagement"
              title="Engagement warnings"
              icon={TrendingDown}
              items={getListItems('engagement', insights.engagementWarnings)}
              expanded={expanded.engagement ?? false}
              onToggleExpand={() =>
                setExpanded(prev => ({ ...prev, engagement: !prev.engagement }))
              }
              emptyLabel="Not enough data yet."
              editMode={editMode}
              hiddenItems={hiddenInsights.engagement}
              onClearHidden={() => clearHiddenInsights('engagement')}
              onRemoveItem={item => handleRemoveItem('engagement', item)}
              onHideBox={() => handleHideBox('engagement')}
              generatedAt={generatedAt}
              now={now}
              shouldAnimate={shouldAnimate}
              animationDelayMs={120}
            />
          ) : null}
          {mode !== 'member' && !hiddenBoxIds.has('finance') ? (
            <InsightList
              listKey="finance"
              title="Financial risks"
              icon={Wallet}
              items={getListItems('finance', insights.financeRisks)}
              expanded={expanded.finance ?? false}
              onToggleExpand={() =>
                setExpanded(prev => ({ ...prev, finance: !prev.finance }))
              }
              emptyLabel="Not enough data yet."
              editMode={editMode}
              hiddenItems={hiddenInsights.finance}
              onClearHidden={() => clearHiddenInsights('finance')}
              onRemoveItem={item => handleRemoveItem('finance', item)}
              onHideBox={() => handleHideBox('finance')}
              generatedAt={generatedAt}
              now={now}
              shouldAnimate={shouldAnimate}
              animationDelayMs={240}
            />
          ) : null}
          {customBoxes
            .filter(box => !hiddenBoxIds.has(box.id))
            .map((box, index) => (
            <InsightList
              key={box.id}
              listKey={box.id}
              title={box.title}
              icon={Lightbulb}
              items={getCustomListItems(box.id)}
              expanded={expanded[box.id] ?? false}
              onToggleExpand={() =>
                setExpanded(prev => ({ ...prev, [box.id]: !(prev[box.id] ?? false) }))
              }
              emptyLabel="Not enough data yet."
              editMode={editMode}
              hiddenItems={hiddenInsights[box.id] ?? []}
              onClearHidden={() => clearHiddenInsights(box.id)}
              onRemoveItem={item => handleRemoveItem(box.id, item)}
              onHideBox={() => handleHideBox(box.id)}
              generatedAt={generatedAt}
              now={now}
              shouldAnimate={shouldAnimate}
              animationDelayMs={360 + index * 120}
            />
          ))}
        </div>
        {insights.bestPracticeNudge && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            style={
              generatedAt
                ? { animation: `insightBoxIn 360ms ease-out both` }
                : undefined
            }
          >
            <Lightbulb className="mt-0.5 h-4 w-4" />
            <span>
              {typewriterText({
                text: insights.bestPracticeNudge,
                startAt: generatedAt + 300,
                now,
              })}
            </span>
          </div>
        )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5" />
        Default insights are based on live group data. Adding a custom insight uses AI.
      </div>
      </CardContent>
    </Card>
  );
}
