"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft, MessageSquarePlus, Search, Send, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser, useGroupChats, useMembers, useMessages } from "@/lib/data-hooks";
import {
  getMessageTimestampMs,
  isMessageFromActor,
  markMessageReadByActor,
  messageIncludesReader,
  normalizeMessage,
  normalizeGroupChats,
  normalizeMessageActor,
  normalizeMessageMap,
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
  text: z.string().min(1, "Message cannot be empty").max(500, "Message too long"),
});

const MESSAGE_SEND_THROTTLE_MS = 500;

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
  const { data: members, loading: membersLoading } = useMembers();
  const {
    data: allMessages,
    setLocalData: setLocalMessages,
    loading: messagesLoading,
    refreshData: refreshMessages,
    clubId,
    orgId,
  } = useMessages();
  const {
    data: groupChats,
    updateData: setGroupChats,
    setLocalData: setLocalGroupChats,
    loading: groupsLoading,
    refreshData: refreshGroupChats,
  } = useGroupChats();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isNewGroupDialogOpen, setIsNewGroupDialogOpen] = useState(false);
  const safeMembers = useMemo(() => normalizeMembersForMessages(members), [members]);
  const safeAllMessages = useMemo(() => normalizeMessageMap(allMessages), [allMessages]);
  const safeGroupChats = useMemo(() => normalizeGroupChats(groupChats), [groupChats]);
  const currentUserEmail = normalizeMessageActor(user?.email);
  const refreshConversationState = useCallback(
    async () => {
      const refreshed = await refreshMessages();
      if (refreshed) {
        return true;
      }
      return refreshGroupChats();
    },
    [refreshGroupChats, refreshMessages]
  );

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

  useEffect(() => {
    void refreshConversationState();
  }, [refreshConversationState]);

  const newGroupForm = useForm<z.infer<typeof newGroupFormSchema>>({
    resolver: zodResolver(newGroupFormSchema),
    defaultValues: { name: "", members: [] },
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshConversationState();
    }, 5000);
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

  const filteredConversations = conversationSummaries.filter(conversation => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;
    return (
      conversation.name.toLowerCase().includes(query) ||
      conversation.subtitle.toLowerCase().includes(query)
    );
  });
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
    router.push(getConversationHref({ type: "group", chat: newGroup }));
  };

  if (userLoading || membersLoading || messagesLoading || groupsLoading) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-header page-header-safe-inset px-4">
          <h2 className="text-xl font-semibold text-foreground">Messages</h2>
        </div>
        <div className="tab-page-content px-4">
          <div className="text-sm text-muted-foreground">Loading messages...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-header page-header-safe-inset px-4">
          <h2 className="text-xl font-semibold text-foreground">Messages</h2>
        </div>
        <div className="tab-page-content px-4">
          <div className="text-sm text-muted-foreground">Please log in to see messages.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages-screen messages-list-screen flex min-h-0 flex-1 flex-col justify-start overflow-hidden bg-background">
      <div className="header tab-page-header page-header-safe-inset relative space-y-3 px-4">
        <div className="flex items-center justify-between">
          <h2 className="w-full text-center text-xl font-semibold text-foreground">Messages</h2>
          <Dialog open={isNewGroupDialogOpen} onOpenChange={setIsNewGroupDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-11 w-11 rounded-2xl">
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

        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Search conversations"
            className="h-12 rounded-xl border-border/70 pl-11"
          />
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
                  onClick={() => router.push(getConversationHref({ type: "dm", partner: member }))}
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
  const { user, loading: userLoading } = useCurrentUser();
  const { data: members, loading: membersLoading } = useMembers();
  const {
    data: allMessages,
    updateData: setAllMessages,
    setLocalData: setLocalMessages,
    refreshData: refreshMessages,
    loading: messagesLoading,
    clubId,
    orgId,
  } = useMessages();
  const {
    data: groupChats,
    updateData: setGroupChats,
    setLocalData: setLocalGroupChats,
    refreshData: refreshGroupChats,
    loading: groupsLoading,
  } = useGroupChats();
  const { toast } = useToast();
  const [lastMessageAt, setLastMessageAt] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const safeMembers = useMemo(() => normalizeMembersForMessages(members), [members]);
  const safeAllMessages = useMemo(() => normalizeMessageMap(allMessages), [allMessages]);
  const safeGroupChats = useMemo(() => normalizeGroupChats(groupChats), [groupChats]);
  const currentUserEmail = normalizeMessageActor(user?.email);
  const refreshConversationState = useCallback(
    async () => {
      const refreshed = await refreshMessages();
      if (refreshed) {
        return true;
      }
      return refreshGroupChats();
    },
    [refreshGroupChats, refreshMessages]
  );

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

  useEffect(() => {
    void refreshConversationState();
  }, [refreshConversationState]);

  const conversation = useMemo(
    () => resolveConversationFromRoute(conversationId, safeMembers, safeGroupChats),
    [conversationId, safeGroupChats, safeMembers]
  );

  const messageForm = useForm<z.infer<typeof messageFormSchema>>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { text: "" },
  });

  const activeMessages = useMemo(() => {
    if (!user || !conversation) return [];
    if (conversation.type === "dm") {
      return safeAllMessages[getConversationId(user.email, conversation.partner.email)] || [];
    }
    const currentChat = safeGroupChats.find(chat => chat.id === conversation.chat.id);
    return currentChat?.messages || [];
  }, [conversation, safeAllMessages, safeGroupChats, user]);

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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshConversationState();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refreshConversationState]);

  const handleSendMessage = async (values: z.infer<typeof messageFormSchema>) => {
    if (!user || !conversation) return;
    if (isSending) return;
    const now = Date.now();
    if (now - lastMessageAt < MESSAGE_SEND_THROTTLE_MS) {
      toast({ title: "Slow down", description: "Please wait a moment before sending another message." });
      return;
    }

    const newMessage: Message = {
      sender: currentUserEmail || user.email,
      text: values.text,
      timestamp: new Date().toISOString(),
      readBy: [currentUserEmail || user.email],
    };

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
            }
          : {
              orgId: selectedOrgId,
              groupId: selectedGroupId,
              conversationType: "group",
              chatId: conversation.chat.id,
              clientTimestamp: newMessage.timestamp,
              text: values.text,
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

  if (userLoading || membersLoading || messagesLoading || groupsLoading) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-header page-header-safe-inset px-4">
          <h2 className="text-xl font-semibold text-foreground">Messages</h2>
        </div>
        <div className="tab-page-content px-4">
          <div className="text-sm text-muted-foreground">Loading conversation...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="tab-page-shell bg-background">
        <div className="tab-page-header page-header-safe-inset px-4">
          <h2 className="text-xl font-semibold text-foreground">Messages</h2>
        </div>
        <div className="tab-page-content px-4">
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
      </div>

      <div className="messages-content flex min-h-0 flex-1 flex-col items-stretch justify-start overflow-y-auto px-4 pt-4">
        {activeMessages.length === 0 ? (
          <div className="tab-empty-state text-sm text-muted-foreground">
            Start the conversation with {title}
          </div>
        ) : (
          <div className="space-y-2">
            {activeMessages.map((message, index) => {
              const isMine = isMessageFromActor(message, currentUserEmail);
              const sender = safeMembers.find(member => member.email === normalizeMessageActor(message.sender));
              return (
                <div key={`${message.timestamp}-${index}`} className={cn("flex w-full", isMine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-4 py-3 text-sm break-words",
                      isMine ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                  >
                    {conversation.type === "group" && !isMine ? (
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{sender?.name || message.sender}</p>
                    ) : null}
                    <p>{message.text}</p>
                    <p className={cn("mt-1 text-right text-[11px]", isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {formatTimestamp(message.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="header shrink-0 border-t bg-background px-4 pt-3 pb-[calc(0.85rem+var(--safe-area-bottom-runtime))]">
        <form onSubmit={messageForm.handleSubmit(handleSendMessage)} className="flex items-end gap-2">
          <Input
            {...messageForm.register("text")}
            autoComplete="off"
            placeholder="Message"
            disabled={isSending}
            className="min-h-11 rounded-xl border-border/70"
          />
          <Button type="submit" size="icon" className="h-11 w-11 rounded-xl" disabled={isSending}>
            <Send className="h-4 w-4" />
            <span className="sr-only">Send message</span>
          </Button>
        </form>
      </div>
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
  const conversations: Conversation[] = [
    ...groupChats.map(chat => ({ type: "group", chat } as Conversation)),
    ...members
      .filter(member => member.email !== currentUserEmail)
      .map(partner => ({ type: "dm", partner } as Conversation)),
  ];

  return conversations
    .map(conversation => {
      const messages = getMessagesForConversation(conversation, currentUserEmail, allMessages, groupChats);
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
  groupChats: GroupChat[]
) {
  if (!currentUserEmail) return [];
  if (conversation.type === "dm") {
    return allMessages[getConversationId(currentUserEmail, conversation.partner.email)] || [];
  }
  return groupChats.find(chat => chat.id === conversation.chat.id)?.messages || [];
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
