'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Send } from 'lucide-react';

/*
Previous assistant implementation preserved for later restore:

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Send, User as UserIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { notifyOrgAiUsageChanged, useCurrentUser } from '@/lib/data-hooks';
import { useGroupUserStateSection } from '@/lib/group-user-state';
import {
  runAssistantAction,
  type AssistantActionResult,
  type AssistantHistoryItem,
  type AssistantResponse,
} from './actions';

const formSchema = z.object({
  query: z.string().min(1, 'Please enter a message.'),
});

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AssistantActionResult[];
  needsFollowup?: boolean;
};

type StoredAssistantState = {
  history: ChatMessage[];
};

const defaultState: StoredAssistantState = {
  history: [],
};

const aiSparkle =
  'bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]';

const toHistoryPayload = (messages: ChatMessage[]): AssistantHistoryItem[] =>
  messages.slice(-3).map(message => ({
    role: message.role,
    content: message.content,
  }));

const normalizeStoredState = (value: unknown): StoredAssistantState => {
  if (!value || typeof value !== 'object') return defaultState;
  const history: ChatMessage[] = [];
  if (Array.isArray((value as { history?: unknown }).history)) {
    for (const item of (value as { history: unknown[] }).history) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as {
        id?: unknown;
        role?: unknown;
        content?: unknown;
        actions?: unknown;
        needsFollowup?: unknown;
      };
      if (
        typeof candidate.id !== 'string' ||
        (candidate.role !== 'user' && candidate.role !== 'assistant') ||
        typeof candidate.content !== 'string'
      ) {
        continue;
      }
      history.push({
        id: candidate.id,
        role: candidate.role,
        content: candidate.content,
        actions: Array.isArray(candidate.actions)
          ? (candidate.actions as AssistantActionResult[])
          : undefined,
        needsFollowup:
          typeof candidate.needsFollowup === 'boolean'
            ? candidate.needsFollowup
            : undefined,
      });
    }
  }

  return { history };
};

export default function AssistantPage() {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { data, updateData, loading } = useGroupUserStateSection<StoredAssistantState>(
    'assistant',
    defaultState
  );
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const assistantState = useMemo(() => normalizeStoredState(data), [data]);
  const messages = assistantState.history;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      query: '',
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRunning]);

  const appendMessages = async (nextMessages: ChatMessage[]) => {
    await updateData({
      history: nextMessages,
    });
  };

  const handleAssistantResponse = async (
    existing: ChatMessage[],
    response: AssistantResponse
  ) => {
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: response.followupQuestion ?? response.reply,
      actions: response.actions,
      needsFollowup: response.needsFollowup,
    };
    await appendMessages([...existing, assistantMessage]);
  };

  const onSubmit = form.handleSubmit(async values => {
    console.log('SUBMIT CLICKED');
    if (isRunning) return;
    const inputValue = values.query.trim();
    console.log('USER INPUT:', inputValue);
    if (!inputValue) return;

    const nextHistory = [
      ...messages,
      {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: inputValue,
      },
    ];

    form.reset();
    setIsRunning(true);
    await appendMessages(nextHistory);
    try {
      console.log('START REQUEST');
      console.log('CALLING runAssistantAction');
      const result = await runAssistantAction(inputValue, toHistoryPayload(messages));
      console.log('RESULT:', result);
      console.log('SUCCESS:', result);
      setIsRunning(false);

      if (!result.ok) {
        toast({
          title: 'Assistant error',
          description: result.error.message,
          variant: 'destructive',
        });
        return;
      }

      notifyOrgAiUsageChanged(undefined, 1);
      await handleAssistantResponse(nextHistory, result.data);
    } catch (err) {
      setIsRunning(false);
      console.error('FRONTEND ERROR:', err);
      toast({
        title: 'Assistant error',
        description: 'Request failed before reaching the server.',
        variant: 'destructive',
      });
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Assistant</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh] pr-4">
            <div className="space-y-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading assistant history...
                </div>
              ) : messages.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Try: "how many viewed my last announcement", "remind those who didn't view it",
                  or "check who missed saturday event and deduct 1 point".
                </div>
              ) : (
                messages.map(message => (
                  <div
                    key={message.id}
                    className={`rounded-xl border p-4 ${
                      message.role === 'assistant' ? 'bg-muted/40' : 'bg-background'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {message.role === 'assistant' ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <UserIcon className="h-4 w-4" />
                      )}
                      <span>
                        {message.role === 'assistant' ? 'Assistant' : user?.name || 'You'}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                    {message.actions && message.actions.length > 0 ? (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        {message.actions.map((action, index) => (
                          <div
                            key={`${message.id}-${action.tool}-${index}`}
                            className="rounded-md bg-background px-3 py-2 text-xs"
                          >
                            <div className="font-medium">
                              {action.tool} | {action.status}
                            </div>
                            {action.error ? (
                              <div className="mt-1 text-destructive">{action.error}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {isRunning ? (
                <div className="flex items-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running assistant...
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="flex gap-3">
            <Input
              {...form.register('query')}
              placeholder="Ask the assistant to read data, message members, or deduct points."
              disabled={isRunning}
              autoComplete="off"
            />
            <Button
              type="submit"
              onClick={() => console.log('SUBMIT CLICKED')}
              disabled={isRunning}
              className={aiSparkle}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
*/

export default function AssistantPage() {
  return (
    <div className="tab-page-shell">
      <div className="tab-page-header">
        <h1 className="text-2xl font-semibold">Assistant</h1>
      </div>
      <div className="tab-page-content pt-2">
    <div className="tab-page-fill gap-6">
      <Card className="tab-page-fill-card">
        <CardHeader>
          <CardTitle>Assistant</CardTitle>
        </CardHeader>
        <CardContent className="tab-page-fill-body">
          <div className="tab-page-fill gap-6">
            <div className="tab-page-empty-fill rounded-xl border bg-muted/20 px-6 py-10">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Unavailable right now</h2>
                <p className="mt-3 text-sm text-muted-foreground">Coming soon.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Input
                value=""
                readOnly
                disabled
                placeholder="Assistant is unavailable right now."
                autoComplete="off"
              />
              <Button type="button" disabled>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
      </div>
    </div>
  );
}
