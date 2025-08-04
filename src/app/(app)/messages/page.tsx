
"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMembers, useCurrentUser, useMessages, useGroupChats } from "@/lib/data-hooks";
import type { Member, User, Message, GroupChat } from '@/lib/mock-data';
import { cn } from "@/lib/utils";
import { Send, Plus, Users, MessageSquare, Loader2, Wand2 } from 'lucide-react';
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { generateChatReply } from "@/ai/flows/generate-chat-reply";

type Conversation = 
  | { type: 'dm'; partner: Member }
  | { type: 'group'; chat: GroupChat };

const groupChatFormSchema = z.object({
  name: z.string().min(3, "Group name must be at least 3 characters."),
  members: z.array(z.string()).min(1, "You must select at least one member."),
});

function MessagesContent({
  selectedConversation,
  onSelectConversation,
}: {
  selectedConversation: Conversation | null;
  onSelectConversation: (conversation: Conversation | null) => void;
}) {
  const { user, loading: userLoading } = useCurrentUser();
  const { data: allMessages, updateData: setAllMessages, loading: messagesLoading } = useMessages();
  const { data: groupChats, updateData: setGroupChats, loading: groupsLoading } = useGroupChats();

  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestedReply, setSuggestedReply] = useState("");
  const scrollAreaViewport = useRef<HTMLDivElement>(null);

  const markDmAsRead = useCallback((partnerEmail: string) => {
    if (!user) return;
    setAllMessages(prevMessages => {
        const newMessages = {...prevMessages};
        const dmKey = [user.email, partnerEmail].sort().join(':');
        if (newMessages[dmKey]) {
            newMessages[dmKey] = newMessages[dmKey].map(m => ({ ...m, read: true }));
        }
        return newMessages;
    });
  }, [user, setAllMessages]);

  const markGroupAsRead = useCallback((chatId: string) => {
    setGroupChats(prevChats => {
        const newChats = prevChats.map(chat => {
            if (chat.id === chatId) {
                return {
                    ...chat,
                    messages: chat.messages.map(m => ({ ...m, read: true })),
                };
            }
            return chat;
        });
        return newChats;
    });
  }, [setGroupChats]);

  useEffect(() => {
    if (selectedConversation) {
      if (selectedConversation.type === 'dm') {
        markDmAsRead(selectedConversation.partner.email);
      } else {
        markGroupAsRead(selectedConversation.chat.id);
      }
    }
  }, [selectedConversation, markDmAsRead, markGroupAsRead]);

  useEffect(() => {
    if (scrollAreaViewport.current) {
      scrollAreaViewport.current.scrollTop = scrollAreaViewport.current.scrollHeight;
    }
  }, [allMessages, groupChats, selectedConversation]);

  const handleSendMessage = () => {
    if (!message.trim() || !user || !selectedConversation) return;

    const newMessage: Message = {
      sender: user.email,
      senderName: user.name,
      text: message,
      timestamp: new Date().toISOString(),
      read: true,
    };

    if (selectedConversation.type === 'dm') {
      const dmKey = [user.email, selectedConversation.partner.email].sort().join(':');
      const updatedMessages = { ...allMessages };
      if (!updatedMessages[dmKey]) {
        updatedMessages[dmKey] = [];
      }
      updatedMessages[dmKey].push(newMessage);
      setAllMessages(updatedMessages);
    } else { // group chat
      const updatedGroupChats = groupChats.map(chat => {
        if (chat.id === selectedConversation.chat.id) {
          return { ...chat, messages: [...chat.messages, newMessage] };
        }
        return chat;
      });
      setGroupChats(updatedGroupChats);
    }
    
    setMessage("");
    setSuggestedReply("");
  };

  const handleGenerateReply = async (history: Message[]) => {
    if (!user) return;
    setIsGenerating(true);
    setSuggestedReply("");
    try {
        const historyText = history.slice(-5).map(m => `${m.sender === user.email ? 'You' : m.senderName}: ${m.text}`).join('\n');
        const result = await generateChatReply({ history: historyText });
        if(result.reply) {
          setSuggestedReply(result.reply);
        }
    } catch (error) {
        console.error("Failed to generate reply", error);
    } finally {
        setIsGenerating(false);
    }
  }

  if (userLoading || messagesLoading || groupsLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
  }

  if (!selectedConversation || !user) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center text-center h-full bg-gray-50 dark:bg-gray-800/50">
        <MessageSquare className="w-16 h-16 text-gray-400" />
        <h2 className="mt-4 text-2xl font-semibold">Select a conversation</h2>
        <p className="mt-2 text-gray-500">Choose a person or group from the left to start chatting.</p>
      </div>
    );
  }

  const currentMessages = selectedConversation.type === 'dm'
    ? allMessages[[user.email, selectedConversation.partner.email].sort().join(':')] || []
    : groupChats.find(chat => chat.id === selectedConversation.chat.id)?.messages || [];

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900/50 rounded-r-xl">
      {/* Header */}
      <header className="flex items-center gap-4 p-4 border-b">
        <Avatar>
            <AvatarImage src={selectedConversation.type === 'dm' ? selectedConversation.partner.avatar : undefined} />
            <AvatarFallback>
            {selectedConversation.type === 'dm' 
                ? selectedConversation.partner.name.charAt(0) 
                : selectedConversation.chat.name.charAt(0)}
            </AvatarFallback>
        </Avatar>
        <div>
            <h3 className="font-semibold">
                {selectedConversation.type === 'dm' ? selectedConversation.partner.name : selectedConversation.chat.name}
            </h3>
            {selectedConversation.type === 'group' && (
                <p className="text-xs text-gray-500">{selectedConversation.chat.members.length} members</p>
            )}
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-grow p-4" viewportRef={scrollAreaViewport}>
        <div className="space-y-4">
          {currentMessages.map((msg, index) => (
            <div
              key={index}
              className={cn("flex items-end gap-2", msg.sender === user.email ? "justify-end" : "justify-start")}
            >
              {msg.sender !== user.email && (
                <Avatar className="w-8 h-8">
                  <AvatarFallback>{msg.senderName.charAt(0)}</AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "max-w-xs md:max-w-md lg:max-w-lg rounded-2xl px-4 py-2 text-sm",
                  msg.sender === user.email
                    ? "bg-primary text-primary-foreground rounded-br-none"
                    : "bg-gray-200 dark:bg-gray-700 rounded-bl-none"
                )}
              >
                {msg.sender !== user.email && (
                    <p className="text-xs font-semibold pb-1">{msg.senderName}</p>
                )}
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      
      {/* Input */}
      <div className="p-4 border-t bg-background shrink-0">
         {suggestedReply && (
            <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-muted-foreground">Suggested:</p>
                <Button variant="outline" size="sm" className="h-auto py-1" onClick={() => { setMessage(suggestedReply); setSuggestedReply(""); }}>
                    "{suggestedReply}"
                </Button>
            </div>
          )}
        <div className="flex items-center gap-2">
           <Button variant="ghost" size="icon" disabled={isGenerating} onClick={() => handleGenerateReply(currentMessages)}>
                {isGenerating ? <Loader2 className="animate-spin" /> : <Wand2 />}
                <span className="sr-only">Generate Reply</span>
            </Button>
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type a message..."
            className="flex-grow"
          />
          <Button onClick={handleSendMessage} disabled={!message.trim()}>
            <Send className="w-4 h-4" />
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewGroupChatDialog({ children }: { children: React.ReactNode }) {
    const { data: members, loading: membersLoading } = useMembers();
    const { data: groupChats, updateData: setGroupChats } = useGroupChats();
    const { user } = useCurrentUser();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);

    const form = useForm<z.infer<typeof groupChatFormSchema>>({
        resolver: zodResolver(groupChatFormSchema),
        defaultValues: {
            name: "",
            members: [],
        },
    });

    const onSubmit = (values: z.infer<typeof groupChatFormSchema>) => {
        if (!user) return;
        const newGroupChat: GroupChat = {
            id: Date.now().toString(),
            name: values.name,
            members: [...values.members, user.email],
            messages: [],
        };
        setGroupChats([...groupChats, newGroupChat]);
        toast({ title: "Group chat created!" });
        setIsOpen(false);
        form.reset();
    };
    
    if (!user) return null;

    const availableMembers = members.filter(m => m.email !== user.email);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create a new group chat</DialogTitle>
                    <DialogDescription>
                        Select members to start a new conversation.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <div className="space-y-4 py-4">
                        <div>
                            <label htmlFor="group-name" className="text-sm font-medium">Group Name</label>
                            <Input id="group-name" {...form.register('name')} placeholder="e.g., Event Planning Committee"/>
                            {form.formState.errors.name && <p className="text-sm text-destructive mt-1">{form.formState.errors.name.message}</p>}
                        </div>
                        <div className="space-y-2">
                             <label className="text-sm font-medium">Members</label>
                             {form.formState.errors.members && <p className="text-sm text-destructive">{form.formState.errors.members.message}</p>}
                             <div className="max-h-60 overflow-y-auto space-y-2 p-1">
                             {membersLoading ? (
                                <p>Loading members...</p>
                             ) : availableMembers.length > 0 ? (
                                availableMembers.map(member => (
                                <div key={member.email} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`member-${member.email}`}
                                        onCheckedChange={(checked) => {
                                            const currentMembers = form.getValues('members');
                                            if (checked) {
                                                form.setValue('members', [...currentMembers, member.email]);
                                            } else {
                                                form.setValue('members', currentMembers.filter(email => email !== member.email));
                                            }
                                        }}
                                    />
                                    <label htmlFor={`member-${member.email}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {member.name}
                                    </label>
                                </div>
                             ))) : (
                                <p className="text-sm text-muted-foreground">No other members in this club.</p>
                             )}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                        <Button type="submit">Create Group</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default function MessagesPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const { data: members, loading: membersLoading } = useMembers();
  const { data: allMessages, loading: messagesLoading } = useMessages();
  const { data: groupChats, loading: groupsLoading } = useGroupChats();

  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  const getUnreadCount = useCallback((convo: Conversation): number => {
    if (!user) return 0;
    if (convo.type === 'dm') {
        const dmKey = [user.email, convo.partner.email].sort().join(':');
        const messages = allMessages[dmKey] || [];
        return messages.filter(m => !m.read && m.sender !== user.email).length;
    } else {
        return convo.chat.messages.filter(m => !m.read && m.sender !== user.email).length;
    }
  }, [user, allMessages]);
  
  const getLastMessage = (convo: Conversation): Message | null => {
      if (!user) return null;
       if (convo.type === 'dm') {
          const dmKey = [user.email, convo.partner.email].sort().join(':');
          const messages = allMessages[dmKey] || [];
          return messages.length > 0 ? messages[messages.length - 1] : null;
      } else {
          return convo.chat.messages.length > 0 ? convo.chat.messages[convo.chat.messages.length - 1] : null;
      }
  }

  if (userLoading || membersLoading || messagesLoading || groupsLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
  }
  
  if (!user) {
    return <div>Please log in to view messages.</div>;
  }

  const directMessagePartners = members.filter(m => m.email !== user.email);
  
  const dmConversations: Conversation[] = directMessagePartners.map(partner => ({
      type: 'dm',
      partner
  }));
  
  const groupConversations: Conversation[] = groupChats
    .filter(chat => chat.members.includes(user.email))
    .map(chat => ({
        type: 'group',
        chat
    }));

  const allConversations = [...groupConversations, ...dmConversations].sort((a, b) => {
      const lastMsgA = getLastMessage(a);
      const lastMsgB = getLastMessage(b);
      if (!lastMsgA) return 1;
      if (!lastMsgB) return -1;
      return new Date(lastMsgB.timestamp).getTime() - new Date(lastMsgA.timestamp).getTime();
  });


  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] h-full gap-4">
      <aside className="flex flex-col bg-white dark:bg-gray-900 border-r rounded-l-xl">
        <header className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold">Chats</h2>
           <NewGroupChatDialog>
              <Button variant="ghost" size="icon">
                <Plus className="w-5 h-5" />
                <span className="sr-only">New Group Chat</span>
              </Button>
            </NewGroupChatDialog>
        </header>
        <ScrollArea className="flex-grow">
          {allConversations.map((convo, index) => {
            const unreadCount = getUnreadCount(convo);
            const lastMessage = getLastMessage(convo);
            const isSelected = selectedConversation?.type === convo.type && (
                (selectedConversation.type === 'dm' && convo.type === 'dm' && selectedConversation.partner.email === convo.partner.email) ||
                (selectedConversation.type === 'group' && convo.type === 'group' && selectedConversation.chat.id === convo.chat.id)
            );
            
            const convoName = convo.type === 'dm' ? convo.partner.name : convo.chat.name;
            const convoAvatar = convo.type === 'dm' ? convo.partner.avatar : undefined;

            return (
              <div
                key={index}
                onClick={() => setSelectedConversation(convo)}
                className={cn(
                  "flex items-center gap-4 p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800",
                  isSelected && "bg-primary/10 dark:bg-primary/20"
                )}
              >
                <Avatar>
                  <AvatarImage src={convoAvatar} />
                  <AvatarFallback>
                    {convo.type === 'group' && <Users className="w-4 h-4"/>}
                    {convo.type === 'dm' && convoName.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-grow truncate">
                  <h4 className="font-semibold truncate">{convoName}</h4>
                  {lastMessage && <p className={cn("text-xs truncate", unreadCount > 0 ? "text-primary font-bold" : "text-gray-500")}>{lastMessage.text}</p>}
                </div>
                {unreadCount > 0 && (
                  <div className="bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount}
                  </div>
                )}
              </div>
            );
          })}
        </ScrollArea>
      </aside>
      <main className="h-full overflow-hidden">
        <MessagesContent selectedConversation={selectedConversation} onSelectConversation={setSelectedConversation} />
      </main>
    </div>
  );
}
