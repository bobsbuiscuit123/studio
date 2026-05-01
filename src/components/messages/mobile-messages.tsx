"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft, Check, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Reply, Search, Send, Trash2, Users, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { findPolicyViolation, policyErrorMessage } from "@/lib/content-policy";
import { useCurrentUser, useMessagingData } from "@/lib/data-hooks";
import {
  MESSAGE_TEXT_MAX_CHARS,
  clearConversationMessages,
  createMessageReplyReference,
  getMessageEntityId,
  getMessageTimestampMs,
  getMessageTimelineKey,
  isMessageFromActor,
  markMessageReadByActor,
  messageIncludesReader,
  normalizeMessage,
  normalizeMessageReplyReference,
  normalizeGroupChats,
  normalizeMessageActor,
  normalizeMessageMap,
  replaceConversationMessage,
  replaceGroupChatMessage,
  removeConversationMessages,
  removeGroupChatMessages,
  upsertConversationMessage,
  upsertGroupChatMessage,
} from "@/lib/message-state";
import type { GroupChat, Member, Message } from "@/lib/mock-data";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Conversation =
  | { type: "dm"; partner: Member }
  | { type: "group"; chat: GroupChat };

type ConversationSummary = {
  id: string;
  href: string;
  name: string;
  subtitle: string;
  timestampLabel: string;
  lastTimestamp: number;
  unread: boolean;
  avatar?: string;
  initials: string;
  isGroup: boolean;
};

const newGroupFormSchema = z.object({
  name: z.string().min(3, "Group name must be at least 3 characters."),
  members: z.array(z.string()).min(2, "You must select at least two members for a group chat."),
});

const messageFormSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(MESSAGE_TEXT_MAX_CHARS, `Message too long (${MESSAGE_TEXT_MAX_CHARS.toLocaleString()} characters max)`),
});

const MESSAGE_SEND_THROTTLE_MS = 500;
const MESSAGE_BACKGROUND_REFRESH_MS = 2 * 60_000;

type MessageAuditEnvelope = {
  conversationType: "dm" | "group";
  conversationKey?: string;
  chatId?: string;
  message: Message;
};

const parseMessageAuditEnvelope = (value: unknown): MessageAuditEnvelope | null => {
  const parsedValue = (() => {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (!parsedValue) {
    return null;
  }

  const conversationType =
    parsedValue.conversationType === "dm" || parsedValue.conversationType === "group"
      ? parsedValue.conversationType
      : null;
  const message = normalizeMessage(parsedValue.message);
  if (!conversationType || !message) {
    return null;
  }

  if (conversationType === "dm") {
    const conversationKey =
      typeof parsedValue.conversationKey === "string" ? normalizeMessageActor(parsedValue.conversationKey) : "";
    return conversationKey ? { conversationType, conversationKey, message } : null;
  }

  const chatId = typeof parsedValue.chatId === "string" ? parsedValue.chatId.trim() : "";
  return chatId ? { conversationType, chatId, message } : null;
};

const dispatchGroupStateSync = (orgId: string, groupId: string) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("group-state-sync", {
      detail: { orgId, groupId },
    })
  );
};

const dispatchPolicyViolation = (message = policyErrorMessage) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("policy-violation", {
      detail: { message },
    })
  );
};

function useLiveGroupStateMessages({
  orgId,
  groupId,
  refreshState,
  onRealtimeMessage,
}: {
  orgId?: string | null;
  groupId?: string | null;
  refreshState: () => Promise<boolean>;
  onRealtimeMessage?: (envelope: MessageAuditEnvelope) => boolean;
}) {
  useEffect(() => {
    if (!orgId || !groupId) {
      return;
    }

    let active = true;
    let refreshTimer: number | null = null;
    let removeChannel: (() => void) | null = null;
    const scheduleRefresh = () => {
      if (!active) return;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshState();
      }, 40);
    };

    try {
      const supabase = createSupabaseBrowserClient();
      const channel = supabase
        .channel(`group-state-messages:${orgId}:${groupId}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `group_id=eq.${groupId}`,
        }, (payload: unknown) => {
          const envelope = parseMessageAuditEnvelope(
            payload && typeof payload === "object" && "new" in payload
              ? (payload as { new?: { content?: unknown } }).new?.content
              : undefined
          );
          if (envelope && onRealtimeMessage?.(envelope)) {
            return;
          }
          scheduleRefresh();
        })
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "group_state",
          filter: `group_id=eq.${groupId}`,
        }, scheduleRefresh)
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "group_state",
          filter: `group_id=eq.${groupId}`,
        }, scheduleRefresh)
        .subscribe((status: "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR") => {
          if (status === "CHANNEL_ERROR") {
            console.error("Realtime message sync channel failed", { orgId, groupId });
          }
        });
      removeChannel = () => {
        void supabase.removeChannel(channel);
      };
    } catch (error) {
      console.error("Realtime message sync setup failed", { orgId, groupId, error });
    }

    return () => {
      active = false;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      removeChannel?.();
    };
  }, [groupId, onRealtimeMessage, orgId, refreshState]);
}

export function MessagesListScreen() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const {
    members,
    messages: allMessages,
    setLocalMessages,
    groupChats,
    updateGroupChats: setGroupChats,
    setLocalGroupChats,
    loading,
    refreshData: refreshConversationState,
    clubId,
    orgId,
  } = useMessagingData();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isNewGroupDialogOpen, setIsNewGroupDialogOpen] = useState(false);
  const safeMembers = useMemo(() => normalizeMembersForMessages(members), [members]);
  const safeAllMessages = useMemo(() => normalizeMessageMap(allMessages), [allMessages]);
  const safeGroupChats = useMemo(() => normalizeGroupChats(groupChats), [groupChats]);
  const currentUserEmail = normalizeMessageActor(user?.email);

  const handleRealtimeMessage = useCallback((envelope: MessageAuditEnvelope) => {
    if (envelope.conversationType === "dm" && envelope.conversationKey) {
      setLocalMessages(prev => upsertConversationMessage(prev, envelope.conversationKey!, envelope.message));
      if (orgId && clubId) {
        dispatchGroupStateSync(orgId, clubId);
      }
      return true;
    }

    if (envelope.conversationType === "group" && envelope.chatId) {
      setLocalGroupChats(prev => upsertGroupChatMessage(prev, envelope.chatId!, envelope.message));
      if (orgId && clubId) {
        dispatchGroupStateSync(orgId, clubId);
      }
      return true;
    }

    return false;
  }, [clubId, orgId, setLocalGroupChats, setLocalMessages]);

  useLiveGroupStateMessages({
    orgId,
    groupId: clubId,
    refreshState: refreshConversationState,
    onRealtimeMessage: handleRealtimeMessage,
  });

  const newGroupForm = useForm<z.infer<typeof newGroupFormSchema>>({
    resolver: zodResolver(newGroupFormSchema),
    defaultValues: { name: "", members: [] },
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshConversationState();
    }, MESSAGE_BACKGROUND_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refreshConversationState]);

  const conversationSummaries = useMemo(
    () =>
      buildConversationSummaries({
        members: safeMembers,
        groupChats: safeGroupChats,
        allMessages: safeAllMessages,
        currentUserEmail,
      }),
    [currentUserEmail, safeAllMessages, safeGroupChats, safeMembers]
  );

  const filteredConversations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return conversationSummaries;
    }
    return conversationSummaries.filter(conversation =>
      conversation.name.toLowerCase().includes(query) ||
      conversation.subtitle.toLowerCase().includes(query)
    );
  }, [conversationSummaries, searchTerm]);
  const availableDirectMessages = safeMembers.filter(member => member.email !== currentUserEmail);

  const handleCreateGroup = (values: z.infer<typeof newGroupFormSchema>) => {
    if (!user) return;
    const creatorEmail = normalizeMessageActor(user.email);
    const newGroup: GroupChat = {
      id: `group_${Date.now()}`,
      name: values.name,
      members: Array.from(new Set([...values.members.map(normalizeMessageActor), creatorEmail].filter(Boolean))),
      messages: [],
    };
    setGroupChats(prev => [newGroup, ...normalizeGroupChats(prev)]);
    setIsNewGroupDialogOpen(false);
    newGroupForm.reset();
    toast({ title: "Group created", description: newGroup.name });
    router.push(getConversationHref({ type: "group", chat: newGroup }), { scroll: false });
  };

  if (userLoading || loading) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-content px-4 pt-2">
          <div className="text-sm text-muted-foreground">Loading messages...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-content px-4 pt-2">
          <div className="text-sm text-muted-foreground">Please log in to see messages.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-screen messages-list-screen flex min-h-0 flex-1 flex-col justify-start overflow-hidden bg-background">
      <div className="header tab-page-header page-header-safe-inset px-4">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Search conversations"
              className="h-12 rounded-xl border-border/70 pl-11"
            />
          </div>
          <Dialog open={isNewGroupDialogOpen} onOpenChange={setIsNewGroupDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl border-border/70">
                <MessageSquarePlus className="h-5 w-5" />
                <span className="sr-only">Create new group chat</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Group Chat</DialogTitle>
                <DialogDescription>Select members to include in your new group.</DialogDescription>
              </DialogHeader>
              <form id="new-group-form" onSubmit={newGroupForm.handleSubmit(handleCreateGroup)} className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="group-name">Group Name</Label>
                  <Input id="group-name" {...newGroupForm.register("name")} placeholder="Event Planning Committee" />
                  {newGroupForm.formState.errors.name ? (
                    <p className="text-sm text-destructive">{newGroupForm.formState.errors.name.message}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Members</Label>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border p-3">
                    {safeMembers
                      .filter(member => member.email !== currentUserEmail)
                      .map(member => (
                        <label key={member.email} htmlFor={`member-${member.email}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-2">
                          <Checkbox
                            id={`member-${member.email}`}
                            onCheckedChange={checked => {
                              const currentMembers = newGroupForm.getValues("members");
                              const nextMembers = checked
                                ? [...currentMembers, member.email]
                                : currentMembers.filter(email => email !== member.email);
                              newGroupForm.setValue("members", nextMembers, { shouldValidate: true });
                            }}
                          />
                          <span className="truncate text-sm">{member.name}</span>
                        </label>
                      ))}
                  </div>
                  {newGroupForm.formState.errors.members ? (
                    <p className="text-sm text-destructive">{newGroupForm.formState.errors.members.message}</p>
                  ) : null}
                </div>
              </form>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsNewGroupDialogOpen(false)}>Cancel</Button>
                <Button type="submit" form="new-group-form">Create Group</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="messages-content flex min-h-0 flex-1 flex-col items-stretch justify-start overflow-y-auto px-4 pt-2">
        {filteredConversations.length === 0 ? (
          availableDirectMessages.length > 0 ? (
            <div className="space-y-2">
              {availableDirectMessages.map(member => (
                <button
                  key={member.email}
                  type="button"
                  onClick={() => router.push(getConversationHref({ type: "dm", partner: member }), { scroll: false })}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors active:scale-[0.99] hover:bg-muted/40"
                >
                  <ConversationAvatar
                    name={member.name}
                    avatar={member.avatar}
                    initials={getInitials(member.name)}
                    isGroup={false}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{member.name}</p>
                    <p className="truncate text-sm text-muted-foreground">Start a conversation</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="tab-empty-state text-sm text-muted-foreground">
              No other members available to message yet
            </div>
          )
        ) : (
          <div className="space-y-2">
            {filteredConversations.map(conversation => (
              <Link
                key={conversation.id}
                href={conversation.href}
                scroll={false}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors active:scale-[0.99] hover:bg-muted/40"
              >
                <ConversationAvatar
                  name={conversation.name}
                  avatar={conversation.avatar}
                  initials={conversation.initials}
                  isGroup={conversation.isGroup}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="truncate text-sm font-semibold">{conversation.name}</p>
                    {conversation.unread ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{conversation.subtitle}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{conversation.timestampLabel}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageChatScreen({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useCurrentUser();
  const {
    members,
    messages: allMessages,
    updateMessages: setAllMessages,
    setLocalMessages,
    groupChats,
    updateGroupChats: setGroupChats,
    setLocalGroupChats,
    refreshData: refreshConversationState,
    loading,
    clubId,
    orgId,
  } = useMessagingData();
  const { toast } = useToast();
  const [lastMessageAt, setLastMessageAt] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [isDeleteSelectedDialogOpen, setIsDeleteSelectedDialogOpen] = useState(false);
  const [isDeleteConversationDialogOpen, setIsDeleteConversationDialogOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message["replyTo"] | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [isSavingMessageEdit, setIsSavingMessageEdit] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasAutoScrolledOnOpenRef = useRef(false);
  const safeMembers = useMemo(() => normalizeMembersForMessages(members), [members]);
  const safeAllMessages = useMemo(() => normalizeMessageMap(allMessages), [allMessages]);
  const safeGroupChats = useMemo(() => normalizeGroupChats(groupChats), [groupChats]);
  const memberByEmail = useMemo(
    () => new Map(safeMembers.map(member => [member.email, member])),
    [safeMembers]
  );
  const groupChatById = useMemo(
    () => new Map(safeGroupChats.map(chat => [chat.id, chat])),
    [safeGroupChats]
  );
  const currentUserEmail = normalizeMessageActor(user?.email);
  const focusedMessageId = searchParams.get("messageId");

  const handleRealtimeMessage = useCallback((envelope: MessageAuditEnvelope) => {
    if (envelope.conversationType === "dm" && envelope.conversationKey) {
      setLocalMessages(prev => upsertConversationMessage(prev, envelope.conversationKey!, envelope.message));
      if (orgId && clubId) {
        dispatchGroupStateSync(orgId, clubId);
      }
      return true;
    }

    if (envelope.conversationType === "group" && envelope.chatId) {
      setLocalGroupChats(prev => upsertGroupChatMessage(prev, envelope.chatId!, envelope.message));
      if (orgId && clubId) {
        dispatchGroupStateSync(orgId, clubId);
      }
      return true;
    }

    return false;
  }, [clubId, orgId, setLocalGroupChats, setLocalMessages]);

  useLiveGroupStateMessages({
    orgId,
    groupId: clubId,
    refreshState: refreshConversationState,
    onRealtimeMessage: handleRealtimeMessage,
  });

  const conversation = useMemo(
    () => resolveConversationFromRoute(conversationId, safeMembers, safeGroupChats),
    [conversationId, safeGroupChats, safeMembers]
  );

  const messageForm = useForm<z.infer<typeof messageFormSchema>>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { text: "" },
  });
  const composerField = messageForm.register("text");

  const activeMessages = useMemo(() => {
    if (!user || !conversation) return [];
    if (conversation.type === "dm") {
      return safeAllMessages[getConversationId(user.email, conversation.partner.email)] || [];
    }
    const currentChat = groupChatById.get(conversation.chat.id);
    return currentChat?.messages || [];
  }, [conversation, groupChatById, safeAllMessages, user]);
  const selectedMessageIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);

  useEffect(() => {
    if (!conversation || !currentUserEmail) return;

    if (conversation.type === "dm") {
      const conversationKey = getConversationId(currentUserEmail, conversation.partner.email);
      setAllMessages(prev => {
        const normalizedMessages = normalizeMessageMap(prev);
        const currentMessages = normalizedMessages[conversationKey] || [];
        if (!currentMessages.some(message => !messageIncludesReader(message, currentUserEmail))) {
          return prev;
        }
        return {
          ...normalizedMessages,
          [conversationKey]: currentMessages.map(message => markMessageReadByActor(message, currentUserEmail)),
        };
      });
    } else {
      setGroupChats(prev => {
        const normalizedChats = normalizeGroupChats(prev);
        let changed = false;
        const nextChats = normalizedChats.map(chat => {
          if (chat.id !== conversation.chat.id) return chat;
          if (!chat.messages.some(message => !messageIncludesReader(message, currentUserEmail))) return chat;
          changed = true;
          return {
            ...chat,
            messages: chat.messages.map(message => markMessageReadByActor(message, currentUserEmail)),
          };
        });
        return changed ? nextChats : normalizedChats;
      });
    }
  }, [conversation, currentUserEmail, setAllMessages, setGroupChats]);

  useEffect(() => {
    const activeMessageIds = new Set(
      activeMessages.map(message => getMessageEntityId(message)).filter(Boolean)
    );
    setSelectedMessageIds(currentSelection => {
      const nextSelection = currentSelection.filter(messageId => activeMessageIds.has(messageId));
      return nextSelection.length === currentSelection.length ? currentSelection : nextSelection;
    });

    if (activeMessages.length === 0) {
      setIsSelectionMode(false);
      setIsDeleteSelectedDialogOpen(false);
    }
  }, [activeMessages]);

  useEffect(() => {
    if (!replyingTo) {
      return;
    }

    const repliedMessageStillExists = activeMessages.some(
      message => getMessageEntityId(message) === replyingTo.id
    );
    if (!repliedMessageStillExists) {
      setReplyingTo(null);
    }
  }, [activeMessages, replyingTo]);

  useEffect(() => {
    if (!editingMessage) {
      return;
    }

    const editingMessageEntityId = getMessageEntityId(editingMessage);
    const editingMessageTimelineKey = getMessageTimelineKey(editingMessage);
    const editingMessageStillExists = activeMessages.some(message =>
      getMessageEntityId(message) === editingMessageEntityId ||
      Boolean(editingMessageTimelineKey && getMessageTimelineKey(message) === editingMessageTimelineKey)
    );
    if (!editingMessageStillExists) {
      setEditingMessage(null);
      messageForm.reset();
    }
  }, [activeMessages, editingMessage, messageForm]);

  useEffect(() => {
    if (!focusedMessageId || loading) {
      return;
    }

    const hasTargetMessage = activeMessages.some(
      message => getMessageEntityId(message) === focusedMessageId
    );
    if (!hasTargetMessage) {
      toast({
        title: "Message unavailable",
        description: "This item is no longer available.",
        variant: "destructive",
      });
      router.replace(`/messages/${conversationId}`);
    }
  }, [activeMessages, conversationId, focusedMessageId, loading, router, toast]);

  useEffect(() => {
    hasAutoScrolledOnOpenRef.current = false;
    setReplyingTo(null);
    setEditingMessage(null);
    setIsSavingMessageEdit(false);
  }, [conversationId, focusedMessageId]);

  useLayoutEffect(() => {
    if (focusedMessageId) {
      const messageElement = document.getElementById(`message-${encodeURIComponent(focusedMessageId)}`);
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: "smooth", block: "center" });
        hasAutoScrolledOnOpenRef.current = true;
        return;
      }
    }

    if (!hasAutoScrolledOnOpenRef.current) {
      const container = messagesContainerRef.current;
      if (!container) return;

      const scrollToBottom = () => {
        container.scrollTop = container.scrollHeight;
      };

      scrollToBottom();
      const frameId = window.requestAnimationFrame(() => {
        scrollToBottom();
        messagesEndRef.current?.scrollIntoView({ block: "end" });
      });
      const timeoutId = window.setTimeout(scrollToBottom, 80);
      hasAutoScrolledOnOpenRef.current = true;
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(timeoutId);
      };
    }

    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeMessages, focusedMessageId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshConversationState();
    }, MESSAGE_BACKGROUND_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refreshConversationState]);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedMessageIds([]);
    setIsDeleteSelectedDialogOpen(false);
  }, []);

  const toggleMessageSelection = useCallback((messageId: string) => {
    if (!messageId) {
      return;
    }

    setSelectedMessageIds(currentSelection =>
      currentSelection.includes(messageId)
        ? currentSelection.filter(currentId => currentId !== messageId)
        : [...currentSelection, messageId]
    );
  }, []);

  const handleStartReply = useCallback((message: Message) => {
    const replyReference = createMessageReplyReference(message);
    if (!replyReference) {
      return;
    }

    setEditingMessage(null);
    setReplyingTo(replyReference);
    window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
  }, []);

  const handleStartEdit = useCallback((message: Message) => {
    setReplyingTo(null);
    setEditingMessage(message);
    messageForm.reset({ text: message.text });
    window.setTimeout(() => composerTextareaRef.current?.focus(), 0);
  }, [messageForm]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setIsSavingMessageEdit(false);
    messageForm.reset();
  }, [messageForm]);

  const handleSelectableMessageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, messageId: string) => {
    if (!isSelectionMode) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    toggleMessageSelection(messageId);
  }, [isSelectionMode, toggleMessageSelection]);

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void messageForm.handleSubmit(editingMessage ? handleEditMessage : handleSendMessage)();
  };

  const handleDeleteSelectedMessages = async () => {
    if (!conversation) return;
    if (selectedMessageIds.length === 0) return;

    const selectedOrgId = orgId ?? window.localStorage.getItem("selectedOrgId");
    const selectedGroupId = clubId ?? window.sessionStorage.getItem("selectedGroupId");
    if (!selectedOrgId || !selectedGroupId) {
      toast({
        title: "Delete failed",
        description: "No active group is selected.",
        variant: "destructive",
      });
      return;
    }

    setIsDeletingSelected(true);

    const response = await fetch("/api/messages/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        conversation.type === "dm"
          ? {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              deleteMode: "messages",
              conversationType: "dm",
              partnerEmail: conversation.partner.email,
              messageEntityIds: selectedMessageIds,
            }
          : {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              deleteMode: "messages",
              conversationType: "group",
              chatId: conversation.chat.id,
              messageEntityIds: selectedMessageIds,
            }
      ),
    }).then(async res => {
      const json = await res.json().catch(() => null);
      return { ok: res.ok, data: json };
    }).catch(() => ({ ok: false, data: null }));

    setIsDeletingSelected(false);

    if (!response.ok) {
      toast({
        title: "Delete failed",
        description: response.data?.error?.message || "The selected messages could not be deleted.",
        variant: "destructive",
      });
      return;
    }

    const deletedMessageEntityIds = Array.isArray(response.data?.data?.deletedMessageEntityIds)
      ? response.data.data.deletedMessageEntityIds
      : selectedMessageIds;

    if (conversation.type === "dm") {
      const conversationKey = getConversationId(user?.email || currentUserEmail, conversation.partner.email);
      setLocalMessages(prev => removeConversationMessages(prev, conversationKey, deletedMessageEntityIds));
    } else {
      setLocalGroupChats(prev => removeGroupChatMessages(prev, conversation.chat.id, deletedMessageEntityIds));
    }

    if (focusedMessageId && deletedMessageEntityIds.includes(focusedMessageId)) {
      router.replace(`/messages/${conversationId}`);
    }

    setIsDeleteSelectedDialogOpen(false);
    exitSelectionMode();
    void refreshConversationState();
    toast({
      title: selectedMessageIds.length === 1 ? "Message deleted" : "Messages deleted",
      description: "Deleted permanently for everyone in this conversation.",
    });
  };

  const handleDeleteConversation = async () => {
    if (!conversation || conversation.type !== "dm") return;

    const selectedOrgId = orgId ?? window.localStorage.getItem("selectedOrgId");
    const selectedGroupId = clubId ?? window.sessionStorage.getItem("selectedGroupId");
    if (!selectedOrgId || !selectedGroupId) {
      toast({
        title: "Delete failed",
        description: "No active group is selected.",
        variant: "destructive",
      });
      return;
    }

    setIsDeletingConversation(true);

    const response = await fetch("/api/messages/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: selectedOrgId,
        groupId: selectedGroupId,
        deleteMode: "conversation",
        conversationType: "dm",
        partnerEmail: conversation.partner.email,
      }),
    }).then(async res => {
      const json = await res.json().catch(() => null);
      return { ok: res.ok, data: json };
    }).catch(() => ({ ok: false, data: null }));

    setIsDeletingConversation(false);

    if (!response.ok) {
      toast({
        title: "Delete failed",
        description: response.data?.error?.message || "The conversation could not be deleted.",
        variant: "destructive",
      });
      return;
    }

    const conversationKey = getConversationId(user?.email || currentUserEmail, conversation.partner.email);
    setLocalMessages(prev => clearConversationMessages(prev, conversationKey));
    setIsDeleteConversationDialogOpen(false);
    exitSelectionMode();
    messageForm.reset();
    void refreshConversationState();
    router.push("/messages");
    toast({
      title: "Conversation deleted",
      description: "The conversation was permanently deleted for both people.",
    });
  };

  const handleEditMessage = async (values: z.infer<typeof messageFormSchema>) => {
    if (!user || !conversation || !editingMessage) return;
    if (isSending || isSavingMessageEdit) return;

    const nextText = values.text.trim();
    const previousText = editingMessage.text.trim();
    if (nextText === previousText) {
      handleCancelEdit();
      return;
    }

    const selectedOrgId = orgId ?? window.localStorage.getItem("selectedOrgId");
    const selectedGroupId = clubId ?? window.sessionStorage.getItem("selectedGroupId");
    if (!selectedOrgId || !selectedGroupId) {
      toast({
        title: "Edit failed",
        description: "No active group is selected.",
        variant: "destructive",
      });
      return;
    }

    if (findPolicyViolation(nextText)) {
      dispatchPolicyViolation();
      return;
    }

    const originalMessageEntityId = getMessageEntityId(editingMessage);
    if (!originalMessageEntityId) {
      toast({
        title: "Edit failed",
        description: "This message cannot be edited.",
        variant: "destructive",
      });
      return;
    }

    const optimisticMessage: Message = {
      ...editingMessage,
      text: nextText,
      editedAt: new Date().toISOString(),
    };

    if (conversation.type === "dm") {
      const conversationKey = getConversationId(user.email, conversation.partner.email);
      setLocalMessages(prev => replaceConversationMessage(prev, conversationKey, originalMessageEntityId, optimisticMessage));
    } else {
      setLocalGroupChats(prev => replaceGroupChatMessage(prev, conversation.chat.id, originalMessageEntityId, optimisticMessage));
    }
    setIsSavingMessageEdit(true);

    const response = await fetch("/api/messages/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        conversation.type === "dm"
          ? {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              conversationType: "dm",
              partnerEmail: conversation.partner.email,
              messageEntityId: originalMessageEntityId,
              text: nextText,
            }
          : {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              conversationType: "group",
              chatId: conversation.chat.id,
              messageEntityId: originalMessageEntityId,
              text: nextText,
            }
      ),
    }).then(async res => {
      const json = await res.json().catch(() => null);
      return { ok: res.ok, data: json };
    }).catch(() => ({ ok: false, data: null }));

    setIsSavingMessageEdit(false);

    if (!response.ok) {
      const optimisticMessageEntityId = getMessageEntityId(optimisticMessage);
      if (conversation.type === "dm") {
        const conversationKey = getConversationId(user.email, conversation.partner.email);
        setLocalMessages(prev => replaceConversationMessage(prev, conversationKey, optimisticMessageEntityId, editingMessage));
      } else {
        setLocalGroupChats(prev => replaceGroupChatMessage(prev, conversation.chat.id, optimisticMessageEntityId, editingMessage));
      }
      dispatchGroupStateSync(selectedOrgId, selectedGroupId);
      messageForm.reset({ text: values.text });
      toast({
        title: "Edit failed",
        description: response.data?.error?.message || "Your message was not updated. Please try again.",
        variant: "destructive",
      });
      return;
    }

    const savedMessage = normalizeMessage(response.data?.data?.message) ?? optimisticMessage;
    const optimisticMessageEntityId = getMessageEntityId(optimisticMessage);
    if (conversation.type === "dm") {
      const conversationKey = getConversationId(user.email, conversation.partner.email);
      setLocalMessages(prev => replaceConversationMessage(prev, conversationKey, optimisticMessageEntityId, savedMessage));
    } else {
      setLocalGroupChats(prev => replaceGroupChatMessage(prev, conversation.chat.id, optimisticMessageEntityId, savedMessage));
    }
    dispatchGroupStateSync(selectedOrgId, selectedGroupId);
    setEditingMessage(null);
    messageForm.reset();
  };

  const handleSendMessage = async (values: z.infer<typeof messageFormSchema>) => {
    if (!user || !conversation) return;
    if (isSending || isSavingMessageEdit || editingMessage) return;
    const now = Date.now();
    if (now - lastMessageAt < MESSAGE_SEND_THROTTLE_MS) {
      toast({ title: "Slow down", description: "Please wait a moment before sending another message." });
      return;
    }

    const replyTo = normalizeMessageReplyReference(replyingTo);
    const newMessage: Message = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sender: currentUserEmail || user.email,
      text: values.text,
      timestamp: new Date().toISOString(),
      readBy: [currentUserEmail || user.email],
      ...(replyTo ? { replyTo } : {}),
    };

    if (findPolicyViolation(newMessage.text)) {
      dispatchPolicyViolation();
      return;
    }

    const selectedOrgId = orgId ?? window.localStorage.getItem("selectedOrgId");
    const selectedGroupId = clubId ?? window.sessionStorage.getItem("selectedGroupId");
    if (!selectedOrgId || !selectedGroupId) {
      toast({
        title: "Message failed",
        description: "No active group is selected.",
        variant: "destructive",
      });
      return;
    }

    if (conversation.type === "dm") {
      const conversationKey = getConversationId(user.email, conversation.partner.email);
      setLocalMessages(prev => upsertConversationMessage(prev, conversationKey, newMessage));
    } else {
      setLocalGroupChats(prev => upsertGroupChatMessage(prev, conversation.chat.id, newMessage));
    }
    dispatchGroupStateSync(selectedOrgId, selectedGroupId);
    setLastMessageAt(now);
    messageForm.reset();
    setReplyingTo(null);
    setIsSending(true);

    const response = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        conversation.type === "dm"
          ? {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              conversationType: "dm",
              clientTimestamp: newMessage.timestamp,
              partnerEmail: conversation.partner.email,
              text: values.text,
              ...(replyTo ? { replyTo } : {}),
            }
          : {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              conversationType: "group",
              chatId: conversation.chat.id,
              clientTimestamp: newMessage.timestamp,
              text: values.text,
              ...(replyTo ? { replyTo } : {}),
            }
      ),
    }).then(async res => {
      const json = await res.json().catch(() => null);
      return { ok: res.ok, data: json };
    }).catch(() => ({ ok: false, data: null }));

    setIsSending(false);
    if (!response.ok) {
      if (conversation.type === "dm") {
        const conversationKey = getConversationId(user.email, conversation.partner.email);
        setLocalMessages(prev => {
          const nextMessages = upsertConversationMessage(prev, conversationKey, null);
          const normalizedMessages = normalizeMessageMap(nextMessages);
          return {
            ...normalizedMessages,
            [conversationKey]: (normalizedMessages[conversationKey] || []).filter(
              message => message.timestamp !== newMessage.timestamp
            ),
          };
        });
      } else {
        setLocalGroupChats(prev =>
          normalizeGroupChats(prev).map(chat =>
            chat.id === conversation.chat.id
              ? {
                  ...chat,
                  messages: chat.messages.filter(message => message.timestamp !== newMessage.timestamp),
                }
              : chat
          )
        );
      }
      dispatchGroupStateSync(selectedOrgId, selectedGroupId);
      messageForm.reset({ text: values.text });
      setReplyingTo(replyTo);
      toast({
        title: "Message failed",
        description: response.data?.error?.message || "Your message was not saved. Please try again.",
        variant: "destructive",
      });
      return;
    }

    const savedMessage = normalizeMessage(response.data?.data?.message) ?? newMessage;
    if (conversation.type === "dm") {
      const conversationKey = getConversationId(user.email, conversation.partner.email);
      setLocalMessages(prev => upsertConversationMessage(prev, conversationKey, savedMessage));
    } else {
      setLocalGroupChats(prev => upsertGroupChatMessage(prev, conversation.chat.id, savedMessage));
    }
    dispatchGroupStateSync(selectedOrgId, selectedGroupId);
  };

  if (userLoading || loading) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-content px-4 pt-2">
          <div className="text-sm text-muted-foreground">Loading conversation...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-content px-4 pt-2">
          <div className="text-sm text-muted-foreground">Please log in to see messages.</div>
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 bg-background px-4 text-left">
        <p className="text-sm text-muted-foreground">Conversation not found</p>
        <Button asChild variant="outline" className="w-fit">
          <Link href="/messages">Back to Messages</Link>
        </Button>
      </div>
    );
  }

  const title = conversation.type === "dm" ? conversation.partner.name : conversation.chat.name;
  const avatar = conversation.type === "dm" ? conversation.partner.avatar : undefined;
  const selectionCount = selectedMessageIds.length;
  const threadActionsDisabled = isDeletingSelected || isDeletingConversation;

  return (
    <div className="messages-screen messages-thread-screen flex min-h-0 flex-1 flex-col justify-start overflow-hidden bg-background">
      <div className="header tab-page-header page-header-safe-inset flex items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl" onClick={() => router.push("/messages")}>
          <ArrowLeft className="h-5 w-5" />
          <span className="sr-only">Back to conversations</span>
        </Button>
        <ConversationAvatar
          name={title}
          avatar={avatar}
          initials={getInitials(title)}
          isGroup={conversation.type === "group"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">{title}</p>
        </div>
        {isSelectionMode ? (
          <Button variant="ghost" size="sm" onClick={exitSelectionMode} disabled={threadActionsDisabled}>
            Cancel
          </Button>
        ) : activeMessages.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 rounded-2xl" disabled={threadActionsDisabled}>
                <MoreHorizontal className="h-5 w-5" />
                <span className="sr-only">Open message actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setIsSelectionMode(true)}>
                Select messages
              </DropdownMenuItem>
              {conversation.type === "dm" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setIsDeleteConversationDialogOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    Delete conversation
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div
        ref={messagesContainerRef}
        className="messages-content flex min-h-0 flex-1 flex-col items-stretch justify-start overflow-y-auto px-4 pt-4"
      >
        {activeMessages.length === 0 ? (
          <div className="tab-empty-state text-sm text-muted-foreground">
            Start the conversation with {title}
          </div>
        ) : (
          <div className="space-y-2">
            {activeMessages.map((message, index) => {
              const isMine = isMessageFromActor(message, currentUserEmail);
              const sender = memberByEmail.get(normalizeMessageActor(message.sender));
              const messageId = getMessageEntityId(message);
              const isFocusedMessage = focusedMessageId === messageId;
              const isSelected = selectedMessageIdSet.has(messageId);
              return (
                <div
                  key={`${messageId}-${index}`}
                  id={`message-${encodeURIComponent(messageId)}`}
                  className={cn(
                    "group/message flex w-full scroll-mt-24 items-end gap-2",
                    isMine ? "justify-end" : "justify-start",
                    isSelectionMode && "cursor-pointer"
                  )}
                  role={isSelectionMode ? "button" : undefined}
                  tabIndex={isSelectionMode ? 0 : undefined}
                  aria-pressed={isSelectionMode ? isSelected : undefined}
                  onClick={isSelectionMode ? () => toggleMessageSelection(messageId) : undefined}
                  onKeyDown={isSelectionMode ? event => handleSelectableMessageKeyDown(event, messageId) : undefined}
                >
                  {isSelectionMode && !isMine ? (
                    <Checkbox checked={isSelected} aria-hidden="true" className="pointer-events-none mb-2" />
                  ) : null}
                  {!isSelectionMode && isMine ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mb-2 h-8 w-8 shrink-0 rounded-full opacity-0 transition-opacity hover:bg-muted group-hover/message:opacity-100 focus-visible:opacity-100"
                      onClick={() => handleStartEdit(message)}
                    >
                      <Pencil className="h-4 w-4" />
                      <span className="sr-only">Edit message</span>
                    </Button>
                  ) : null}
                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-4 py-3 text-sm break-words transition-colors",
                      isMine ? "bg-primary text-primary-foreground" : "bg-muted",
                      isSelectionMode && "ring-1 ring-border/70",
                      isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      isFocusedMessage && "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
                    )}
                  >
                    {conversation.type === "group" && !isMine ? (
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{sender?.name || message.sender}</p>
                    ) : null}
                    {message.replyTo ? (
                      <MessageReplyPreview
                        replyTo={message.replyTo}
                        memberByEmail={memberByEmail}
                        currentUserEmail={currentUserEmail}
                        isMine={isMine}
                      />
                    ) : null}
                    <p className="whitespace-pre-wrap">{message.text}</p>
                    <p className={cn("mt-1 text-right text-[11px]", isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {formatTimestamp(message.timestamp)}
                      {message.editedAt ? " · Edited" : ""}
                    </p>
                  </div>
                  {!isSelectionMode && !isMine ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mb-2 h-8 w-8 shrink-0 rounded-full opacity-0 transition-opacity hover:bg-muted group-hover/message:opacity-100 focus-visible:opacity-100"
                      onClick={() => handleStartReply(message)}
                    >
                      <Reply className="h-4 w-4" />
                      <span className="sr-only">Reply to message</span>
                    </Button>
                  ) : null}
                  {isSelectionMode && isMine ? (
                    <Checkbox checked={isSelected} aria-hidden="true" className="pointer-events-none mb-2" />
                  ) : null}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="header shrink-0 border-t bg-background px-4 pt-3 pb-[calc(0.85rem+var(--safe-area-bottom-runtime))]">
        {isSelectionMode ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {selectionCount > 0 ? `${selectionCount} message${selectionCount === 1 ? "" : "s"} selected` : "Select messages to delete"}
              </p>
              <p className="text-xs text-muted-foreground">
                Deleted messages are removed permanently for everyone in this conversation.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setIsDeleteSelectedDialogOpen(true)}
              disabled={selectionCount === 0 || threadActionsDisabled}
            >
              {isDeletingSelected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </div>
        ) : (
          <>
            {editingMessage ? (
              <div className="mb-2 flex items-center gap-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2">
                <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">Editing message</p>
                  <p className="truncate text-xs text-muted-foreground">{editingMessage.text}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full"
                  onClick={handleCancelEdit}
                  disabled={isSavingMessageEdit}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Cancel edit</span>
                </Button>
              </div>
            ) : replyingTo ? (
              <div className="mb-2 flex items-center gap-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2">
                <Reply className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">
                    Replying to {getMessageSenderLabel(replyingTo.sender, memberByEmail, currentUserEmail)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{replyingTo.text}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full"
                  onClick={() => setReplyingTo(null)}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Cancel reply</span>
                </Button>
              </div>
            ) : null}
            <form onSubmit={messageForm.handleSubmit(editingMessage ? handleEditMessage : handleSendMessage)} className="flex items-end gap-2">
              <div className="flex-1">
                <Textarea
                  {...composerField}
                  ref={element => {
                    composerField.ref(element);
                    composerTextareaRef.current = element;
                  }}
                  autoComplete="off"
                  enterKeyHint="send"
                  placeholder="Message"
                  disabled={isSending || isSavingMessageEdit}
                  rows={1}
                  onKeyDown={handleComposerKeyDown}
                  className="max-h-40 min-h-11 resize-none rounded-xl border-border/70 py-3"
                />
                {messageForm.formState.errors.text ? (
                  <p className="mt-2 text-sm text-destructive">{messageForm.formState.errors.text.message}</p>
                ) : null}
              </div>
              <Button type="submit" size="icon" className="h-11 w-11 rounded-xl" disabled={isSending || isSavingMessageEdit}>
                {isSending || isSavingMessageEdit ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editingMessage ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span className="sr-only">{editingMessage ? "Save message edit" : "Send message"}</span>
              </Button>
            </form>
          </>
        )}
      </div>

      <AlertDialog open={isDeleteSelectedDialogOpen} onOpenChange={setIsDeleteSelectedDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectionCount === 1 ? "this message" : "these messages"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected {selectionCount === 1 ? "message" : "messages"} for everyone in this conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={isDeletingSelected}>Cancel</Button>
            </AlertDialogCancel>
            <Button variant="destructive" onClick={handleDeleteSelectedMessages} disabled={isDeletingSelected}>
              {isDeletingSelected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteConversationDialogOpen} onOpenChange={setIsDeleteConversationDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the entire conversation for both people. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" disabled={isDeletingConversation}>Cancel</Button>
            </AlertDialogCancel>
            <Button variant="destructive" onClick={handleDeleteConversation} disabled={isDeletingConversation}>
              {isDeletingConversation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete conversation
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MessageReplyPreview({
  replyTo,
  memberByEmail,
  currentUserEmail,
  isMine,
}: {
  replyTo: NonNullable<Message["replyTo"]>;
  memberByEmail: Map<string, Member>;
  currentUserEmail: string;
  isMine: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-2 rounded-lg border-l-2 px-3 py-2 text-xs",
        isMine
          ? "border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground/80"
          : "border-primary/50 bg-background/70 text-muted-foreground"
      )}
    >
      <p className={cn("truncate font-semibold", isMine ? "text-primary-foreground" : "text-foreground")}>
        {getMessageSenderLabel(replyTo.sender, memberByEmail, currentUserEmail)}
      </p>
      <p className="truncate">{replyTo.text}</p>
    </div>
  );
}

function ConversationAvatar({
  name,
  avatar,
  initials,
  isGroup,
}: {
  name: string;
  avatar?: string;
  initials: string;
  isGroup: boolean;
}) {
  if (isGroup) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Users className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Avatar className="h-12 w-12">
      <AvatarImage src={avatar} alt={name} />
      <AvatarFallback style={{ backgroundColor: stringToColor(name) }}>{initials}</AvatarFallback>
    </Avatar>
  );
}

function getMessageSenderLabel(
  sender: string,
  memberByEmail: Map<string, Member>,
  currentUserEmail: string
) {
  const normalizedSender = normalizeMessageActor(sender);
  if (normalizedSender && normalizedSender === currentUserEmail) {
    return "You";
  }
  return memberByEmail.get(normalizedSender)?.name || sender;
}

function getConversationPreviewText(
  conversation: Conversation,
  lastMessage: Message | undefined,
  members: Member[],
  currentUserEmail: string
) {
  if (!lastMessage) {
    return conversation.type === "group" ? "Group chat" : "Tap to start chatting";
  }

  const isMine = isMessageFromActor(lastMessage, currentUserEmail);
  if (conversation.type === "dm") {
    return isMine ? `You: ${lastMessage.text}` : lastMessage.text;
  }

  const senderName = isMine
    ? "You"
    : members.find(member => member.email === normalizeMessageActor(lastMessage.sender))?.name ||
      lastMessage.sender;

  return `${senderName}: ${lastMessage.text}`;
}

function buildConversationSummaries({
  members,
  groupChats,
  allMessages,
  currentUserEmail,
}: {
  members: Member[];
  groupChats: GroupChat[];
  allMessages: Record<string, Message[]>;
  currentUserEmail: string;
}): ConversationSummary[] {
  const groupMessagesById = new Map(groupChats.map(chat => [chat.id, chat.messages || []]));
  const conversations: Conversation[] = [
    ...groupChats.map(chat => ({ type: "group", chat } as Conversation)),
    ...members
      .filter(member => member.email !== currentUserEmail)
      .map(partner => ({ type: "dm", partner } as Conversation)),
  ];

  return conversations
    .map(conversation => {
      const messages = getMessagesForConversation(
        conversation,
        currentUserEmail,
        allMessages,
        groupMessagesById
      );
      const lastMessage = messages[messages.length - 1];
      const name = conversation.type === "dm" ? conversation.partner.name : conversation.chat.name;
      return {
        id: getRouteConversationId(conversation),
        href: getConversationHref(conversation),
        name,
        subtitle: getConversationPreviewText(conversation, lastMessage, members, currentUserEmail),
        timestampLabel: lastMessage ? formatTimestamp(lastMessage.timestamp) : "",
        lastTimestamp: getMessageTimestampMs(lastMessage),
        unread: messages.some(
          message => !isMessageFromActor(message, currentUserEmail) && !messageIncludesReader(message, currentUserEmail)
        ),
        avatar: conversation.type === "dm" ? conversation.partner.avatar : undefined,
        initials: getInitials(name),
        isGroup: conversation.type === "group",
      };
    })
    .sort((left, right) => right.lastTimestamp - left.lastTimestamp || left.name.localeCompare(right.name));
}

function getMessagesForConversation(
  conversation: Conversation,
  currentUserEmail: string,
  allMessages: Record<string, Message[]>,
  groupMessagesById: Map<string, Message[]>
) {
  if (!currentUserEmail) return [];
  if (conversation.type === "dm") {
    return allMessages[getConversationId(currentUserEmail, conversation.partner.email)] || [];
  }
  return groupMessagesById.get(conversation.chat.id) || [];
}

function resolveConversationFromRoute(
  routeId: string,
  members: Member[],
  groupChats: GroupChat[]
): Conversation | null {
  if (routeId.startsWith("dm__")) {
    const email = normalizeMessageActor(decodeURIComponent(routeId.slice(4)));
    const partner = members.find(member => member.email === email);
    return partner ? { type: "dm", partner } : null;
  }
  if (routeId.startsWith("group__")) {
    const id = decodeURIComponent(routeId.slice(7));
    const chat = groupChats.find(groupChat => groupChat.id === id);
    return chat ? { type: "group", chat } : null;
  }
  return null;
}

function getConversationHref(conversation: Conversation) {
  return `/messages/${getRouteConversationId(conversation)}`;
}

function getRouteConversationId(conversation: Conversation) {
  return conversation.type === "dm"
    ? `dm__${encodeURIComponent(normalizeMessageActor(conversation.partner.email))}`
    : `group__${encodeURIComponent(conversation.chat.id)}`;
}

function getConversationId(email1: string, email2: string) {
  return [normalizeMessageActor(email1), normalizeMessageActor(email2)].sort().join("_");
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "U";
}

function stringToColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 50%, 70%)`;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function normalizeMembersForMessages(members: Member[]): Member[] {
  return (Array.isArray(members) ? members : []).flatMap(member => {
    const email = normalizeMessageActor(member.email);
    if (!email) {
      return [];
    }

    return [{
      ...member,
      email,
      name: typeof member.name === "string" && member.name.trim() ? member.name.trim() : email,
    }];
  });
}
