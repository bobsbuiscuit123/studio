import { createSupabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchAiChatDataContext,
  type AiChatDataContext,
} from '@/lib/ai-chat-server';
import type { AiChatEntity } from '@/lib/ai-chat';
import type { AgentPlan, RetrievalTargetResource } from '@/lib/assistant/agent/types';

export type RetrievalBundle = {
  context: AiChatDataContext;
  usedEntities: AiChatEntity[];
};

const RESOURCE_ENTITY_MAP: Record<string, AiChatEntity[]> = {
  announcements: ['announcements'],
  events: ['events'],
  members: ['members'],
  messages: ['messages'],
  activity: ['announcements', 'events', 'messages'],
};

export async function fetchAgentRetrievalContext(args: {
  groupId: string;
  role: string;
  plan: AgentPlan;
  requiredResources?: RetrievalTargetResource[];
}): Promise<RetrievalBundle> {
  const requestedEntities = Array.from(
    new Set(
      [
        ...(args.plan.retrievalTargets ?? []).map(target => target.resource),
        ...(args.requiredResources ?? []),
      ].flatMap(resource => RESOURCE_ENTITY_MAP[resource] ?? [])
    )
  );

  if ((!args.plan.needsRetrieval && (args.requiredResources?.length ?? 0) === 0) || requestedEntities.length === 0) {
    return {
      context: {},
      usedEntities: [],
    };
  }

  const admin = createSupabaseAdmin();
  return fetchAiChatDataContext({
    admin,
    groupId: args.groupId,
    entities: requestedEntities,
    role: args.role,
  });
}
