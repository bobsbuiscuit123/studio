import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { canEditGroupContent, normalizeGroupRole } from '@/lib/group-permissions';
import { err, ok, type Result } from '@/lib/result';
import type {
  Announcement,
  ClubEvent,
  Member,
  Message,
  PointEntry,
} from '@/lib/mock-data';
import { z } from 'zod';

type GroupState = {
  announcements?: Announcement[];
  events?: ClubEvent[];
  messages?: Record<string, Message[]>;
  pointEntries?: PointEntry[];
  members?: Member[];
  [key: string]: unknown;
};

type AssistantContext = {
  orgId: string;
  groupId: string;
  userId: string;
  userEmail: string;
  userName: string;
  groupRole: 'admin' | 'officer' | 'member';
  admin: ReturnType<typeof createSupabaseAdmin>;
  groupState: GroupState;
  members: Member[];
};

type ToolDefinition<TInput extends z.ZodTypeAny, TOutput> = {
  name: string;
  description: string;
  inputSchema: TInput;
  execute: (context: AssistantContext, input: z.infer<TInput>) => Promise<Result<TOutput>>;
};

export type AssistantToolResult =
  | {
      tool: string;
      status: 'completed';
      input: unknown;
      output: unknown;
    }
  | {
      tool: string;
      status: 'failed';
      input: unknown;
      error: string;
    };

export type AssistantExecutionResult = Result<{
  results: AssistantToolResult[];
  variables: Record<string, unknown>;
  reply: string;
}>;

const toIsoDate = (value: unknown) => {
  const parsed = new Date(String(value ?? ''));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
};

const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();

const getConversationId = (left: string, right: string) =>
  [normalizeEmail(left), normalizeEmail(right)].sort().join('_');

const toMemberSummary = (member: Member) => ({
  id: member.id ?? null,
  name: member.name,
  email: member.email,
  role: member.role,
});

const toMemberSummaries = (members: Member[]) => members.map(toMemberSummary);

const memberLabel = (value: unknown) => {
  if (value && typeof value === 'object') {
    const candidate = value as { name?: unknown; email?: unknown };
    if (typeof candidate.name === 'string' && candidate.name.trim()) return candidate.name.trim();
    if (typeof candidate.email === 'string' && candidate.email.trim()) return candidate.email.trim();
  }
  return String(value ?? '').trim();
};

const renderVariableValue = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => memberLabel(item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    const candidate = value as { title?: unknown; name?: unknown; id?: unknown };
    if (typeof candidate.title === 'string' && candidate.title.trim()) return candidate.title.trim();
    if (typeof candidate.name === 'string' && candidate.name.trim()) return candidate.name.trim();
    if (typeof candidate.id === 'string' && candidate.id.trim()) return candidate.id.trim();
    return JSON.stringify(value);
  }
  return '';
};

const getPathValue = (value: unknown, path: string[]) => {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const resolveVariable = (expression: string, variables: Record<string, unknown>) => {
  if (!expression.startsWith('$')) return undefined;
  const [root, ...path] = expression.split('.');
  const rootValue = variables[root];
  if (typeof rootValue === 'undefined') return undefined;
  return path.length > 0 ? getPathValue(rootValue, path) : rootValue;
};

const resolveVariablesDeep = (
  value: unknown,
  variables: Record<string, unknown>
): unknown => {
  if (typeof value === 'string') {
    const direct = resolveVariable(value, variables);
    if (typeof direct !== 'undefined') {
      return direct;
    }
    return value.replace(/\$[A-Z0-9_]+(?:\.[A-Za-z0-9_]+)*/g, token => {
      const resolved = resolveVariable(token, variables);
      return typeof resolved === 'undefined' ? token : renderVariableValue(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveVariablesDeep(item, variables));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveVariablesDeep(item, variables),
      ])
    );
  }
  return value;
};

const weekdayMap: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const resolveEventFromReference = (events: ClubEvent[], reference: string) => {
  const normalized = reference.trim().toLowerCase();
  const sorted = [...events].sort(
    (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()
  );
  if (!normalized || /^(last|latest|recent|current)$/i.test(normalized)) {
    return sorted[0] ?? null;
  }

  const weekdayEntry = Object.entries(weekdayMap).find(([label]) => normalized.includes(label));
  if (weekdayEntry) {
    const [, weekday] = weekdayEntry;
    const exact = sorted.filter(event => new Date(event.date).getDay() === weekday);
    if (exact.length > 0) {
      const past = exact.filter(event => new Date(event.date).getTime() <= Date.now());
      return (past[0] ?? exact[0]) || null;
    }
  }

  const titleMatch = sorted.find(event =>
    String(event.title ?? '').toLowerCase().includes(normalized)
  );
  return titleMatch ?? sorted[0] ?? null;
};

const persistGroupState = async (context: AssistantContext) => {
  const { error } = await context.admin
    .from('group_state')
    .upsert(
      {
        org_id: context.orgId,
        group_id: context.groupId,
        data: context.groupState,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' }
    );

  if (error) {
    return err({
      code: 'NETWORK_HTTP_ERROR',
      message: error.message,
      source: 'network',
    });
  }

  return ok(true);
};

const GetLastAnnouncementViewsInputSchema = z.object({}).strict();
const FindEventInputSchema = z.object({
  reference: z.string().min(1),
});
const GetEventAttendanceInputSchema = z.object({
  event_id: z.string().min(1),
});
const SendMessageInputSchema = z.object({
  recipients: z.array(z.union([z.string(), z.object({ email: z.string().email() })])).min(1),
  message: z.string().min(1),
});
const DeductPointsInputSchema = z.object({
  users: z.array(z.union([z.string(), z.object({ email: z.string().email() })])).min(1),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

const getLastAnnouncementViewsTool: ToolDefinition<
  typeof GetLastAnnouncementViewsInputSchema,
  {
    last_announcement: { id: number; title: string; content: string; date: string } | null;
    viewers: ReturnType<typeof toMemberSummaries>;
    not_viewed_users: ReturnType<typeof toMemberSummaries>;
  }
> = {
  name: 'get_last_announcement_views',
  description: "Get viewers and non-viewers for the user's latest announcement.",
  inputSchema: GetLastAnnouncementViewsInputSchema,
  async execute(context) {
    const announcements = Array.isArray(context.groupState.announcements)
      ? [...context.groupState.announcements]
      : [];
    const authored = announcements
      .filter(item => normalizeEmail(item.author) === context.userEmail)
      .sort((left, right) => toIsoDate(right.date).localeCompare(toIsoDate(left.date)));
    const scoped = authored.length > 0 ? authored : announcements.sort((left, right) => toIsoDate(right.date).localeCompare(toIsoDate(left.date)));
    const lastAnnouncement = scoped[0] ?? null;

    if (!lastAnnouncement) {
      return ok({
        last_announcement: null,
        viewers: [],
        not_viewed_users: [],
      });
    }

    const recipientEmails =
      Array.isArray(lastAnnouncement.recipients) && lastAnnouncement.recipients.length > 0
        ? lastAnnouncement.recipients.map(normalizeEmail)
        : context.members.map(member => normalizeEmail(member.email));
    const viewed = new Set(
      (Array.isArray(lastAnnouncement.viewedBy) ? lastAnnouncement.viewedBy : []).map(normalizeEmail)
    );
    const viewers = context.members.filter(member => viewed.has(normalizeEmail(member.email)));
    const notViewed = context.members.filter(member => {
      const email = normalizeEmail(member.email);
      return recipientEmails.includes(email) && !viewed.has(email) && email !== context.userEmail;
    });

    return ok({
      last_announcement: {
        id: lastAnnouncement.id,
        title: lastAnnouncement.title,
        content: lastAnnouncement.content,
        date: lastAnnouncement.date,
      },
      viewers: toMemberSummaries(viewers),
      not_viewed_users: toMemberSummaries(notViewed),
    });
  },
};

const findEventTool: ToolDefinition<
  typeof FindEventInputSchema,
  { event: { id: string; title: string; date: string } | null; event_id: string | null }
> = {
  name: 'find_event',
  description: 'Resolve an event reference like "last", "recent", or "saturday".',
  inputSchema: FindEventInputSchema,
  async execute(context, input) {
    const events = Array.isArray(context.groupState.events) ? context.groupState.events : [];
    const event = resolveEventFromReference(events, input.reference);
    if (!event) {
      return ok({
        event: null,
        event_id: null,
      });
    }
    return ok({
      event: {
        id: event.id,
        title: event.title,
        date: new Date(event.date).toISOString(),
      },
      event_id: event.id,
    });
  },
};

const getEventAttendanceTool: ToolDefinition<
  typeof GetEventAttendanceInputSchema,
  {
    event: { id: string; title: string; date: string } | null;
    attendees: ReturnType<typeof toMemberSummaries>;
    absent_users: ReturnType<typeof toMemberSummaries>;
  }
> = {
  name: 'get_event_attendance',
  description: 'Get attendees and absent users for an event.',
  inputSchema: GetEventAttendanceInputSchema,
  async execute(context, input) {
    const events = Array.isArray(context.groupState.events) ? context.groupState.events : [];
    const event = events.find(item => item.id === input.event_id) ?? null;
    if (!event) {
      return err({
        code: 'VALIDATION',
        message: 'Event not found.',
        source: 'app',
      });
    }
    const attendeesSet = new Set(
      (Array.isArray(event.attendees) ? event.attendees : []).map(normalizeEmail)
    );
    const targetEmails =
      Array.isArray(event.recipients) && event.recipients.length > 0
        ? event.recipients.map(normalizeEmail)
        : context.members.map(member => normalizeEmail(member.email));
    const attendees = context.members.filter(member =>
      attendeesSet.has(normalizeEmail(member.email))
    );
    const absentUsers = context.members.filter(member => {
      const email = normalizeEmail(member.email);
      return targetEmails.includes(email) && !attendeesSet.has(email);
    });

    return ok({
      event: {
        id: event.id,
        title: event.title,
        date: new Date(event.date).toISOString(),
      },
      attendees: toMemberSummaries(attendees),
      absent_users: toMemberSummaries(absentUsers),
    });
  },
};

const sendMessageTool: ToolDefinition<
  typeof SendMessageInputSchema,
  { sent_count: number; recipients: ReturnType<typeof toMemberSummaries> }
> = {
  name: 'send_message',
  description: 'Send a direct message to one or more users.',
  inputSchema: SendMessageInputSchema,
  async execute(context, input) {
    const recipientEmails = Array.from(
      new Set(
        input.recipients
          .map(item => (typeof item === 'string' ? item : item.email))
          .map(normalizeEmail)
          .filter(Boolean)
          .filter(email => email !== context.userEmail)
      )
    );

    if (recipientEmails.length === 0) {
      return err({
        code: 'VALIDATION',
        message: 'No valid recipients.',
        source: 'app',
      });
    }

    const validRecipients = context.members.filter(member =>
      recipientEmails.includes(normalizeEmail(member.email))
    );
    if (validRecipients.length !== recipientEmails.length) {
      return err({
        code: 'VALIDATION',
        message: 'One or more recipients are not in this group.',
        source: 'app',
      });
    }

    const messages =
      context.groupState.messages && typeof context.groupState.messages === 'object'
        ? { ...context.groupState.messages }
        : {};

    const timestamp = new Date().toISOString();
    validRecipients.forEach(member => {
      const conversationId = getConversationId(context.userEmail, member.email);
      const nextMessage: Message = {
        sender: context.userEmail,
        text: input.message,
        timestamp,
        readBy: [context.userEmail],
      };
      messages[conversationId] = [...(messages[conversationId] ?? []), nextMessage];
    });

    context.groupState = {
      ...context.groupState,
      messages,
    };

    const persisted = await persistGroupState(context);
    if (!persisted.ok) return persisted;

    return ok({
      sent_count: validRecipients.length,
      recipients: toMemberSummaries(validRecipients),
    });
  },
};

const deductPointsTool: ToolDefinition<
  typeof DeductPointsInputSchema,
  { updated_count: number; amount: number; users: ReturnType<typeof toMemberSummaries> }
> = {
  name: 'deduct_points',
  description: 'Deduct points from users by appending point adjustment entries.',
  inputSchema: DeductPointsInputSchema,
  async execute(context, input) {
    if (!canEditGroupContent(context.groupRole)) {
      return err({
        code: 'VALIDATION',
        message: 'Only officers or admins can deduct points.',
        source: 'app',
      });
    }

    const targetEmails = Array.from(
      new Set(
        input.users
          .map(item => (typeof item === 'string' ? item : item.email))
          .map(normalizeEmail)
          .filter(Boolean)
      )
    );

    const validUsers = context.members.filter(member =>
      targetEmails.includes(normalizeEmail(member.email))
    );
    if (validUsers.length !== targetEmails.length) {
      return err({
        code: 'VALIDATION',
        message: 'One or more users are not in this group.',
        source: 'app',
      });
    }

    const entries = Array.isArray(context.groupState.pointEntries)
      ? [...context.groupState.pointEntries]
      : [];
    const amount = -Math.abs(input.amount);
    const reason = input.reason?.trim() || 'Assistant deduction';
    const date = new Date().toLocaleDateString();

    validUsers.forEach(member => {
      entries.push({
        id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        memberEmail: member.email,
        points: amount,
        reason,
        date,
        awardedBy: context.userEmail,
      });
    });

    context.groupState = {
      ...context.groupState,
      pointEntries: entries,
    };

    const persisted = await persistGroupState(context);
    if (!persisted.ok) return persisted;

    return ok({
      updated_count: validUsers.length,
      amount: Math.abs(input.amount),
      users: toMemberSummaries(validUsers),
    });
  },
};

export const assistantToolRegistry = {
  get_last_announcement_views: getLastAnnouncementViewsTool,
  find_event: findEventTool,
  get_event_attendance: getEventAttendanceTool,
  send_message: sendMessageTool,
  deduct_points: deductPointsTool,
} as const;

export const assistantToolList = Object.values(assistantToolRegistry).map(tool => ({
  name: tool.name,
  description: tool.description,
  input: tool.inputSchema.shape,
}));

type AssistantToolName = keyof typeof assistantToolRegistry;

export const loadAssistantContext = async (options: {
  orgId: string;
  groupId: string;
  userId: string;
}) => {
  const admin = createSupabaseAdmin();
  const [{ data: groupMembership }, { data: groupStateRow }, { data: profile }] = await Promise.all([
    admin
      .from('group_memberships')
      .select('role')
      .eq('org_id', options.orgId)
      .eq('group_id', options.groupId)
      .eq('user_id', options.userId)
      .maybeSingle(),
    admin.from('group_state').select('data').eq('group_id', options.groupId).maybeSingle(),
    admin
      .from('profiles')
      .select('email, display_name')
      .eq('id', options.userId)
      .maybeSingle(),
  ]);

  if (!groupMembership) {
    return err({
      code: 'VALIDATION',
      message: 'Access denied.',
      source: 'app',
    });
  }

  const state = ((groupStateRow?.data as GroupState | null) ?? {}) as GroupState;
  const stateMembers = Array.isArray(state.members) ? state.members : [];
  const members = stateMembers
    .filter(
      (member): member is Member =>
        Boolean(member) &&
        typeof member.email === 'string' &&
        typeof member.name === 'string' &&
        typeof member.role === 'string' &&
        typeof member.avatar === 'string'
    )
    .map(member => ({ ...member }));

  const userEmail = normalizeEmail(profile?.email);
  return ok({
    orgId: options.orgId,
    groupId: options.groupId,
    userId: options.userId,
    userEmail,
    userName: profile?.display_name || profile?.email || 'Member',
    groupRole: normalizeGroupRole(groupMembership.role),
    admin,
    groupState: state,
    members,
  } satisfies AssistantContext);
};

const registerResultVariables = (
  toolName: AssistantToolName,
  result: unknown,
  variables: Record<string, unknown>,
  index: number
) => {
  variables[`$STEP_${index + 1}`] = result;
  variables.$LAST_RESULT = result;

  if (!result || typeof result !== 'object') return;
  const value = result as Record<string, unknown>;

  if (toolName === 'get_last_announcement_views') {
    variables.$LAST_ANNOUNCEMENT = value.last_announcement ?? null;
    variables.$VIEWERS = value.viewers ?? [];
    variables.$NOT_VIEWED_USERS = value.not_viewed_users ?? [];
    return;
  }

  if (toolName === 'find_event') {
    variables.$EVENT = value.event ?? null;
    variables.$EVENT_ID = value.event_id ?? null;
    return;
  }

  if (toolName === 'get_event_attendance') {
    variables.$EVENT = value.event ?? null;
    variables.$ATTENDEES = value.attendees ?? [];
    variables.$ABSENT_USERS = value.absent_users ?? [];
  }
};

const summarizeToolResult = (result: AssistantToolResult) => {
  if (result.status === 'failed') {
    return result.error;
  }

  if (result.tool === 'get_last_announcement_views') {
    const output = result.output as {
      last_announcement?: { title?: string };
      viewers?: Array<{ name?: string; email?: string }>;
      not_viewed_users?: Array<{ name?: string; email?: string }>;
    };
    const viewers = Array.isArray(output.viewers) ? output.viewers : [];
    const names = viewers.map(memberLabel).filter(Boolean);
    const title = output.last_announcement?.title ? `"${output.last_announcement.title}"` : 'your last announcement';
    if (names.length === 0) {
      return `No one has viewed ${title} yet.`;
    }
    return `${names.length} member${names.length === 1 ? '' : 's'} viewed ${title}: ${names.join(', ')}.`;
  }

  if (result.tool === 'find_event') {
    const output = result.output as { event?: { title?: string; date?: string } | null };
    if (!output.event) {
      return 'No matching event was found.';
    }
    return `Found event "${output.event.title}" on ${new Date(output.event.date ?? '').toLocaleDateString()}.`;
  }

  if (result.tool === 'get_event_attendance') {
    const output = result.output as {
      event?: { title?: string } | null;
      attendees?: Array<{ name?: string; email?: string }>;
      absent_users?: Array<{ name?: string; email?: string }>;
    };
    const attendees = Array.isArray(output.attendees) ? output.attendees : [];
    const absentees = Array.isArray(output.absent_users) ? output.absent_users : [];
    const title = output.event?.title || 'the event';
    return `${attendees.length} attendee${attendees.length === 1 ? '' : 's'} checked in for "${title}". ${absentees.length} member${absentees.length === 1 ? '' : 's'} missed it.`;
  }

  if (result.tool === 'send_message') {
    const output = result.output as { sent_count?: number };
    const count = Number(output.sent_count ?? 0);
    return `Sent ${count} message${count === 1 ? '' : 's'}.`;
  }

  if (result.tool === 'deduct_points') {
    const output = result.output as { updated_count?: number; amount?: number };
    const count = Number(output.updated_count ?? 0);
    const amount = Number(output.amount ?? 0);
    return `Deducted ${amount} point${amount === 1 ? '' : 's'} from ${count} member${count === 1 ? '' : 's'}.`;
  }

  return 'Completed.';
};

export const executeAssistantActions = async (
  context: AssistantContext,
  actions: Array<{ tool: string; input: Record<string, unknown> }>
): Promise<AssistantExecutionResult> => {
  const variables: Record<string, unknown> = {};
  const results: AssistantToolResult[] = [];

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const toolName = action.tool as AssistantToolName;
    const tool = assistantToolRegistry[toolName] as unknown as ToolDefinition<
      z.ZodTypeAny,
      unknown
    >;
    if (!tool) {
      return err({
        code: 'VALIDATION',
        message: `Unknown tool: ${action.tool}`,
        source: 'app',
      });
    }

    const resolvedInput = resolveVariablesDeep(action.input, variables);
    const parsed = tool.inputSchema.safeParse(resolvedInput);
    if (!parsed.success) {
      return err({
        code: 'VALIDATION',
        message: `Invalid input for ${tool.name}.`,
        detail: parsed.error.message,
        source: 'app',
      });
    }

    const output = await tool.execute(context, parsed.data);
    if (!output.ok) {
      results.push({
        tool: tool.name,
        status: 'failed',
        input: parsed.data,
        error: output.error.message,
      });
      return ok({
        results,
        variables,
        reply: output.error.message,
      });
    }

    registerResultVariables(toolName, output.data, variables, index);
    results.push({
      tool: tool.name,
      status: 'completed',
      input: parsed.data,
      output: output.data,
    });
  }

  const reply = results.map(summarizeToolResult).join(' ');
  return ok({
    results,
    variables,
    reply,
  });
};
