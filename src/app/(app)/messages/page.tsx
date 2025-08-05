
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Search, Send, Users, X, MessageSquarePlus } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useCurrentUser, useMembers, useMessages, useGroupChats } from "@/lib/data-hooks";
import { cn } from "@/lib/utils";
import type { Member, Message, GroupChat } from "@/lib/mock-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";


type Conversation = 
  | { type: 'dm'; partner: Member }
  | { type: 'group'; chat: GroupChat };


const messageFormSchema = z.object({
  text: z.string().min(1, "Message cannot be empty"),
});

const newGroupFormSchema = z.object({
  name: z.string().min(3, "Group name must be at least 3 characters."),
  members: z.array(z.string()).min(2, "You must select at least two members for a group chat."),
});


export default function MessagesPage() {
    const { user, loading: userLoading } = useCurrentUser();
    const { data: members, loading: membersLoading } = useMembers();
    const { data: allMessages, updateData: setAllMessages, loading: messagesLoading } = useMessages();
    const { data: groupChats, updateData: setGroupChats, loading: groupsLoading } = useGroupChats();
    const { toast } = useToast();

    const [searchTerm, setSearchTerm] = useState("");
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
    const [isNewGroupDialogOpen, setIsNewGroupDialogOpen] = useState(false);
    
    const messageEndRef = useRef<HTMLDivElement>(null);
    
    const scrollToBottom = () => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [activeConversation, allMessages, groupChats]);

    useEffect(() => {
        const targetMemberString = localStorage.getItem('messageTarget');
        if (targetMemberString && !membersLoading && members.length > 0) {
            try {
                const targetMember: Member = JSON.parse(targetMemberString);
                const fullMember = members.find(m => m.email === targetMember.email);
                if (fullMember) {
                    setActiveConversation({ type: 'dm', partner: fullMember });
                }
            } catch (e) {
                console.error("Failed to parse messageTarget from localStorage", e);
            } finally {
                localStorage.removeItem('messageTarget');
            }
        }
    }, [membersLoading, members]);

    const stableSetAllMessages = useCallback(setAllMessages, []);
    const stableSetGroupChats = useCallback(setGroupChats, []);

    useEffect(() => {
        if (!activeConversation || !user?.email) return;

        if (activeConversation.type === 'dm') {
            stableSetAllMessages(prev => {
                const conversationId = getConversationId(user.email!, activeConversation.partner.email);
                const currentMessages = prev[conversationId] || [];
                let changed = false;

                const updatedMessages = currentMessages.map(msg => {
                    if (!msg.readBy.includes(user.email!)) {
                        changed = true;
                        return { ...msg, readBy: [...msg.readBy, user.email!] };
                    }
                    return msg;
                });

                if (changed) {
                    return { ...prev, [conversationId]: updatedMessages };
                }
                return prev;
            });
        } else { // group
            stableSetGroupChats(prev => {
                const chat = activeConversation.chat;
                let changed = false;

                const updatedChats = prev.map(g => {
                    if (g.id === chat.id) {
                        const updatedMessages = g.messages.map(msg => {
                            if (!msg.readBy.includes(user.email!)) {
                                changed = true;
                                return { ...msg, readBy: [...msg.readBy, user.email!] };
                            }
                            return msg;
                        });
                        return { ...g, messages: updatedMessages };
                    }
                    return g;
                });
                
                return changed ? updatedChats : prev;
            });
        }
    }, [activeConversation, user?.email, stableSetAllMessages, stableSetGroupChats]);

    const messageForm = useForm<z.infer<typeof messageFormSchema>>({
        resolver: zodResolver(messageFormSchema),
        defaultValues: { text: "" },
    });

    const newGroupForm = useForm<z.infer<typeof newGroupFormSchema>>({
      resolver: zodResolver(newGroupFormSchema),
      defaultValues: { name: "", members: [] },
    });

    const handleSendMessage = (values: z.infer<typeof messageFormSchema>) => {
        if (!user || !activeConversation) return;

        const newMessage: Message = {
            sender: user.email,
            text: values.text,
            timestamp: new Date().toISOString(),
            readBy: [user.email], // Sender has always "read" their own message
        };

        if (activeConversation.type === 'dm') {
            const conversationId = getConversationId(user.email, activeConversation.partner.email);
            setAllMessages(prev => ({ ...prev, [conversationId]: [...(prev[conversationId] || []), newMessage] }));
        } else { // group
             const updatedGroupChats = groupChats.map(chat => 
                chat.id === activeConversation.chat.id
                ? { ...chat, messages: [...chat.messages, newMessage] }
                : chat
             );
             setGroupChats(updatedGroupChats);
             const updatedChat = updatedGroupChats.find(chat => chat.id === activeConversation.chat.id);
             if (updatedChat) {
                setActiveConversation({ type: 'group', chat: updatedChat });
             }
        }

        messageForm.reset();
    };

    const handleCreateGroup = (values: z.infer<typeof newGroupFormSchema>) => {
      if (!user) return;
      const newGroup: GroupChat = {
        id: `group_${Date.now()}`,
        name: values.name,
        members: [...values.members, user.email],
        messages: [],
      };

      setGroupChats(prev => [newGroup, ...prev]);
      toast({ title: "Group created!", description: `The group "${newGroup.name}" has been created.`});
      setIsNewGroupDialogOpen(false);
      newGroupForm.reset();
      setActiveConversation({ type: 'group', chat: newGroup });
    }

    const getConversationId = (email1: string, email2: string) => {
        return [email1, email2].sort().join('_');
    };

    const filteredMembers = members.filter(member =>
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) && member.email !== user?.email
    );

    const stringToColor = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = hash % 360;
        return `hsl(${hue}, 50%, 70%)`;
    };
    
    const getLastMessageTimestamp = (conversation: Conversation): string => {
        if (!user) return '1970-01-01T00:00:00.000Z'; // old date for conversations with no messages

        let messages: Message[] = [];
        if (conversation.type === 'dm') {
            const conversationId = getConversationId(user.email, conversation.partner.email);
            messages = allMessages[conversationId] || [];
        } else { // group
            messages = conversation.chat.messages || [];
        }

        if (messages.length === 0) {
            return '1970-01-01T00:00:00.000Z';
        }

        return messages[messages.length - 1].timestamp;
    };
    
    const hasUnreadMessages = (conversation: Conversation): boolean => {
        if (!user || !user.email) return false;
        let messages: Message[] = [];

        if (conversation.type === 'dm') {
            const convoId = getConversationId(user.email, conversation.partner.email);
            messages = allMessages[convoId] || [];
        } else { // group
            const currentChat = groupChats.find(g => g.id === conversation.chat.id);
            messages = currentChat ? currentChat.messages : [];
        }
        return messages.some(m => !m.readBy.includes(user.email!) && m.sender !== user.email);
    };

    const conversations: Conversation[] = [
      ...groupChats.map(chat => ({ type: 'group', chat } as Conversation)),
      ...members
        .filter(m => m.email !== user?.email)
        .map(partner => ({ type: 'dm', partner } as Conversation))
    ].filter((convo, index, self) => {
      if (convo.type === 'dm') {
        const firstIndex = self.findIndex(c => c.type === 'dm' && c.partner.email === convo.partner.email);
        return index === firstIndex;
      }
      return true;
    }).sort((a, b) => {
        const timestampA = new Date(getLastMessageTimestamp(a)).getTime();
        const timestampB = new Date(getLastMessageTimestamp(b)).getTime();
        return timestampB - timestampA;
    });

    const activeMessages = (() => {
        if (!activeConversation || !user) return [];
        if (activeConversation.type === 'dm') {
            const conversationId = getConversationId(user.email, activeConversation.partner.email);
            return allMessages[conversationId] || [];
        }
        const currentChat = groupChats.find(g => g.id === activeConversation.chat.id);
        return currentChat ? currentChat.messages : [];
    })();

    if (userLoading || membersLoading || messagesLoading || groupsLoading) {
        return <div>Loading chats...</div>;
    }

    if (!user) {
        return <div>Please log in to see messages.</div>;
    }

  return (
    <div className="h-[calc(100vh-80px)] flex border rounded-lg bg-card text-card-foreground shadow-sm">
        <aside className="w-1/3 border-r flex flex-col">
            <div className="p-4 border-b">
                <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search members..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <ScrollArea className="flex-1">
                 <div className="p-2">
                    {searchTerm ? (
                        filteredMembers.map(member => (
                            <div
                                key={member.email}
                                onClick={() => setActiveConversation({ type: 'dm', partner: member })}
                                className={cn(
                                    "flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted",
                                    activeConversation?.type === 'dm' && activeConversation.partner.email === member.email && "bg-muted"
                                )}
                            >
                                <Avatar className="h-10 w-10">
                                    <AvatarImage src={member.avatar} />
                                    <AvatarFallback style={{ backgroundColor: stringToColor(member.name) }}>
                                        {member.name.charAt(0)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 truncate">
                                    <p className="font-semibold">{member.name}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <>
                         <Dialog open={isNewGroupDialogOpen} onOpenChange={setIsNewGroupDialogOpen}>
                            <DialogTrigger asChild>
                                <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
                                    <MessageSquarePlus className="h-5 w-5"/> New Group Chat
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create New Group Chat</DialogTitle>
                                    <DialogDescription>Select members to include in your new group.</DialogDescription>
                                </DialogHeader>
                                <form id="new-group-form" onSubmit={newGroupForm.handleSubmit(handleCreateGroup)} className="space-y-4 py-4">
                                     <div>
                                        <Label htmlFor="group-name">Group Name</Label>
                                        <Input id="group-name" {...newGroupForm.register('name')} placeholder="e.g., Event Planning Committee" />
                                        {newGroupForm.formState.errors.name && <p className="text-destructive text-sm mt-1">{newGroupForm.formState.errors.name.message}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Members</Label>
                                        <ScrollArea className="h-48 border rounded-md p-2">
                                        {members.filter(m => m.email !== user.email).map(member => (
                                            <div key={member.email} className="flex items-center space-x-2 py-1">
                                                <Checkbox
                                                    id={`member-${member.email}`}
                                                    onCheckedChange={(checked) => {
                                                        const currentMembers = newGroupForm.getValues("members");
                                                        const newMembers = checked
                                                            ? [...currentMembers, member.email]
                                                            : currentMembers.filter(email => email !== member.email);
                                                        newGroupForm.setValue("members", newMembers);
                                                    }}
                                                />
                                                <Label htmlFor={`member-${member.email}`}>{member.name}</Label>
                                            </div>
                                        ))}
                                        </ScrollArea>
                                        {newGroupForm.formState.errors.members && <p className="text-destructive text-sm mt-1">{newGroupForm.formState.errors.members.message}</p>}
                                    </div>
                                </form>
                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setIsNewGroupDialogOpen(false)}>Cancel</Button>
                                    <Button type="submit" form="new-group-form">Create Group</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <Separator className="my-2" />
                        {conversations.map((convo) => {
                            const name = convo.type === 'dm' ? convo.partner.name : convo.chat.name;
                            const avatar = convo.type === 'dm' ? convo.partner.avatar : undefined;
                            const fallbackText = convo.type === 'dm' ? convo.partner.name.charAt(0) : convo.chat.name.charAt(0);
                            const icon = convo.type === 'group' ? <Users className="h-10 w-10 text-muted-foreground p-2 bg-muted rounded-full"/> : null;
                            const isUnread = hasUnreadMessages(convo);

                            return (
                            <div
                                key={convo.type === 'dm' ? convo.partner.email : convo.chat.id}
                                onClick={() => setActiveConversation(convo)}
                                className={cn(
                                "flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted",
                                activeConversation?.type === convo.type && (activeConversation.type === 'dm' ? activeConversation.partner.email === convo.partner.email : activeConversation.chat.id === convo.chat.id) && "bg-muted"
                                )}
                            >
                                {convo.type === 'dm' ? (
                                    <Avatar className="h-10 w-10">
                                        <AvatarImage src={avatar} />
                                        <AvatarFallback style={{ backgroundColor: stringToColor(name) }}>{fallbackText}</AvatarFallback>
                                    </Avatar>
                                ) : icon}
                                <div className="flex-1 truncate">
                                <p className="font-semibold">{name}</p>
                                </div>
                                {isUnread && (
                                    <span className="ml-auto h-2.5 w-2.5 rounded-full bg-primary"></span>
                                )}
                            </div>
                        )})}
                        </>
                    )}
                 </div>
            </ScrollArea>
        </aside>

        <main className="w-2/3 flex flex-col">
            {activeConversation ? (
                <>
                <header className="p-4 border-b flex items-center gap-3">
                    {activeConversation.type === 'dm' ? (
                         <Avatar className="h-10 w-10">
                            <AvatarImage src={activeConversation.partner.avatar} />
                            <AvatarFallback style={{ backgroundColor: stringToColor(activeConversation.partner.name) }}>
                                {activeConversation.partner.name.charAt(0)}
                            </AvatarFallback>
                        </Avatar>
                    ) : (
                         <Users className="h-10 w-10 text-muted-foreground p-2 bg-muted rounded-full"/>
                    )}
                    <h2 className="text-xl font-bold">
                        {activeConversation.type === 'dm' ? activeConversation.partner.name : activeConversation.chat.name}
                    </h2>
                </header>
                <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                        {activeMessages.map((msg, index) => {
                            const sender = members.find(m => m.email === msg.sender);
                            const isMe = msg.sender === user.email;
                            return (
                                <div key={index} className={cn("flex items-end gap-2", isMe && "justify-end")}>
                                     {!isMe && (
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={sender?.avatar} />
                                            <AvatarFallback style={{ backgroundColor: stringToColor(sender?.name || 'U') }}>
                                                {sender?.name.charAt(0) || 'U'}
                                            </AvatarFallback>
                                        </Avatar>
                                    )}
                                    <div className={cn(
                                        "p-3 rounded-lg max-w-xs md:max-w-md",
                                        isMe ? "bg-primary text-primary-foreground" : "bg-muted"
                                    )}>
                                        <p className="text-sm">{msg.text}</p>
                                        <p className="text-xs text-right opacity-70 mt-1">
                                            {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        </p>
                                    </div>
                                </div>
                            )
                        })}
                         <div ref={messageEndRef} />
                    </div>
                </ScrollArea>
                 <div className="p-4 border-t">
                    <form onSubmit={messageForm.handleSubmit(handleSendMessage)} className="flex items-center gap-2">
                        <Input 
                            {...messageForm.register("text")} 
                            placeholder="Type a message..."
                            autoComplete="off"
                        />
                        <Button type="submit" size="icon" disabled={messageForm.formState.isSubmitting}>
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground">
                    <Users className="h-16 w-16 mb-4" />
                    <h2 className="text-2xl font-bold">Welcome to Messages</h2>
                    <p>Select a conversation or search for a member to start chatting.</p>
                </div>
            )}
        </main>
    </div>
  );
}
