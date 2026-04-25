export type RecipientRef = {
  email: string;
  name?: string;
};

export type AssistantTurnState =
  | 'response'
  | 'retrieval_response'
  | 'draft_preview'
  | 'awaiting_confirmation'
  | 'executing'
  | 'success'
  | 'error'
  | 'needs_clarification';

export type AgentIntent =
  | 'conversational'
  | 'retrieval'
  | 'draft_action'
  | 'execute_action'
  | 'mixed';

export type AgentActionType =
  | 'create_announcement'
  | 'update_announcement'
  | 'create_event'
  | 'update_event'
  | 'create_message'
  | 'update_message'
  | 'create_email'
  | 'update_email';

export type RetrievalTargetResource =
  | 'announcements'
  | 'events'
  | 'members'
  | 'messages'
  | 'activity';

export type AgentPlanAction = {
  type: AgentActionType;
  fieldsProvided: Record<string, unknown>;
  fieldsMissing: string[];
  requiresPreview: boolean;
  requiresConfirmation: boolean;
};

export type AgentPlan = {
  intent: AgentIntent;
  summary: string;
  needsRetrieval: boolean;
  retrievalTargets?: Array<{
    resource: RetrievalTargetResource;
    purpose: string;
  }>;
  action?: AgentPlanAction;
  confidence: number;
};

export type AnnouncementDraftPreview = {
  kind: 'announcement';
  title?: string;
  body?: string;
};

export type EventDraftPreview = {
  kind: 'event';
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  location?: string;
};

export type MessageDraftPreview = {
  kind: 'message';
  recipients?: RecipientRef[];
  body?: string;
};

export type EmailDraftPreview = {
  kind: 'email';
  subject?: string;
  body?: string;
};

export type DraftPreview =
  | AnnouncementDraftPreview
  | EventDraftPreview
  | MessageDraftPreview
  | EmailDraftPreview;

export type AssistantCommand =
  | { kind: 'message'; text: string }
  | {
      kind: 'confirm';
      pendingActionId?: string;
      preview?:
        | { kind: 'announcement'; patch: Partial<AnnouncementDraftPreview> }
        | { kind: 'event'; patch: Partial<EventDraftPreview> }
        | { kind: 'message'; patch: Partial<MessageDraftPreview> }
        | { kind: 'email'; patch: Partial<EmailDraftPreview> };
    }
  | { kind: 'cancel'; pendingActionId: string }
  | {
      kind: 'edit_preview';
      pendingActionId: string;
      preview:
        | { kind: 'announcement'; patch: Partial<AnnouncementDraftPreview> }
        | { kind: 'event'; patch: Partial<EventDraftPreview> }
        | { kind: 'message'; patch: Partial<MessageDraftPreview> }
        | { kind: 'email'; patch: Partial<EmailDraftPreview> };
    }
  | { kind: 'regenerate'; pendingActionId: string };

export type AssistantUiActions = {
  canEdit: boolean;
  canRegenerate: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  editableFields: string[];
};

export type AssistantEntityRef = {
  entityId: string;
  entityType: 'announcement' | 'event' | 'message' | 'email';
};

export type AssistantTurnDiagnostics = {
  phase: 'planner' | 'draft' | 'field_validator' | 'orchestrator' | 'unknown';
  detail?: string;
  requestId?: string;
};

export type AssistantTurnBase = {
  state: AssistantTurnState;
  conversationId: string;
  turnId: string;
  retryCount: number;
  timeoutFlag: boolean;
  diagnostics?: AssistantTurnDiagnostics;
};

export type AssistantTurnResponse =
  | (AssistantTurnBase & {
      state: 'response';
      reply: string;
    })
  | (AssistantTurnBase & {
      state: 'retrieval_response';
      reply: string;
      usedEntities: string[];
    })
  | (AssistantTurnBase & {
      state: 'draft_preview' | 'awaiting_confirmation';
      reply: string;
      preview: DraftPreview;
      pendingActionId: string;
      ui: AssistantUiActions;
      missingFields?: string[];
    })
  | (AssistantTurnBase & {
      state: 'executing';
      reply: string;
      pendingActionId: string;
    })
  | (AssistantTurnBase & {
      state: 'success';
      message: string;
      entityRef?: AssistantEntityRef;
    })
  | (AssistantTurnBase & {
      state: 'error';
      message: string;
      pendingActionId?: string;
    })
  | (AssistantTurnBase & {
      state: 'needs_clarification';
      message: string;
      missingFields?: string[];
      pendingActionId?: string;
    });

export type PendingActionStatus =
  | 'pending'
  | 'confirmed'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PendingActionFields = {
  targetRef?: string;
  recipients?: RecipientRef[];
  [key: string]: unknown;
};

export type GeminiFieldValidationTelemetry = {
  // Confidence is telemetry only. It must never influence gating or execution safety.
  confidence?: number;
  notes?: string[];
};

export type GeminiFieldValidationResult = {
  inferredFields: Record<string, unknown>;
  missingFields: string[];
  clarificationMessage?: string;
  usedInference: boolean;
  telemetry?: GeminiFieldValidationTelemetry;
};

export type PendingAction = {
  id: string;
  conversationId: string;
  userId: string;
  orgId: string;
  groupId: string;
  actionType: AgentActionType;
  actionFields: PendingActionFields;
  originalDraftPayload: DraftPreview;
  currentPayload: DraftPreview;
  status: PendingActionStatus;
  idempotencyKey: string;
  createdAt: string;
  expiresAt: string;
  resultEntityId?: string | null;
  resultEntityType?: AssistantEntityRef['entityType'] | null;
  resultMessage?: string | null;
};

export type AgentContext = {
  role: 'admin' | 'officer' | 'member';
    permissions: {
      canCreateAnnouncements: boolean;
      canUpdateAnnouncements: boolean;
      canCreateEvents: boolean;
      canUpdateEvents: boolean;
      canMessageMembers: boolean;
      canCreateEmails: boolean;
      canUpdateEmails: boolean;
    };
  };

export type AssistantTurnPersistInput = {
  conversationId: string;
  turnId: string;
  userId: string;
  orgId: string;
  groupId: string;
  requestPayload: Record<string, unknown>;
  normalizedPlan?: Record<string, unknown> | null;
  retrievalPayload?: Record<string, unknown> | null;
  responsePayload?: Record<string, unknown> | null;
  state: AssistantTurnState;
  pendingActionId?: string | null;
  retryCount: number;
  timeoutFlag: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
};
