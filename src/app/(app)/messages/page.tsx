
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMembers, useCurrentUser, useMessages, useGroupChats } from "@/lib/data-hooks";
import type { Member, User, Message, GroupChat } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Send, Plus, Users, MessageSquare, Loader2, Wand2, Search } from 'lucide-react';
import Image from 'next/image';
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
import { Label } from '@/components/ui/label';
import { useSearchParams } from 'next/navigation';

type Conversation = 
  | { type: 'dm'; partner: Member }
  | { type: 'group'; chat: GroupChat };

const groupChatFormSchema = z.object({
  name: z.string().min(3, "Group name must be at least 3 characters."),
  members: z.array(z.string()).min(1, "You must select at least one member."),
  avatar: z.any().optional(),
});

function MessagesContent({
  selectedConversation,
  onSendMessage,
}: {
  selectedConversation: Conversation | null;
  onSendMessage: (newMessage: Message) => void;
}) {
  const { user, loading: userLoading } = useCurrentUser();
  const { data: allMessages, updateData: setAllMessages, loading: messagesLoading } = useMessages();
  const { data: groupChats, updateData: setGroupChats, loading: groupsLoading } = useGroupChats();

  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestedReply, setSuggestedReply] = useState("");
  const scrollAreaViewport = useRef<HTMLDivElement>(null);
  
  const convoId = useMemo(() => {
    if (!selectedConversation) return null;
    return selectedConversation.type === 'dm' ? selectedConversation.partner.email : selectedConversation.chat.id;
  }, [selectedConversation]);

  useEffect(() => {
    if (!user || !selectedConversation) return;

    const markAsRead = () => {
        let convoHasUnread = false;
        let currentMessages: Message[] = [];
        
        if (selectedConversation.type === 'dm') {
            const dmKey = [user.email, selectedConversation.partner.email].sort().join(':');
            currentMessages = allMessages[dmKey] || [];
        } else {
            const chat = groupChats.find(c => c.id === selectedConversation.chat.id);
            currentMessages = chat ? chat.messages : [];
        }

        if (currentMessages.some(m => m.readBy && !m.readBy.includes(user.email) && m.sender !== user.email)) {
            convoHasUnread = true;
        }
        
        if (convoHasUnread) {
             if (selectedConversation.type === 'dm') {
                const dmKey = [user.email, selectedConversation.partner.email].sort().join(':');
                setAllMessages(prev => {
                    const newDms = {...prev};
                    newDms[dmKey] = (newDms[dmKey] || []).map(m => ({...m, readBy: [...(m.readBy || []), user.email]}));
                    return newDms;
                });
            } else {
                setGroupChats(prev => prev.map(c => 
                    c.id === selectedConversation.chat.id 
                        ? {...c, messages: c.messages.map(m => ({...m, readBy: [...(m.readBy || []), user.email]}))} 
                        : c
                ));
            }
        }
    }
    setTimeout(markAsRead, 0);

  }, [convoId, user, allMessages, groupChats, selectedConversation, setAllMessages, setGroupChats]);


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
      readBy: [user.email],
    };
    
    onSendMessage(newMessage);
    
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
      <div className="flex-grow flex flex-col items-center justify-center text-center h-full bg-muted/20 dark:bg-card">
        <MessageSquare className="w-16 h-16 text-muted-foreground" />
        <h2 className="mt-4 text-2xl font-semibold">Select a conversation</h2>
        <p className="mt-2 text-muted-foreground">Choose a person or group from the left to start chatting.</p>
      </div>
    );
  }

  const currentMessages = selectedConversation.type === 'dm'
    ? (allMessages && allMessages[[user.email, selectedConversation.partner.email].sort().join(':')]) || []
    : (groupChats.find(chat => chat.id === selectedConversation.chat.id)?.messages) || [];
  
  const convoName = selectedConversation.type === 'dm' ? selectedConversation.partner.name : selectedConversation.chat.name;
  const convoAvatar = selectedConversation.type === 'dm' ? selectedConversation.partner.avatar : selectedConversation.chat.avatar;
  const convoFallback = convoName.charAt(0);


  return (
    <div className="flex flex-col h-full bg-card border-t border-b border-r rounded-r-xl">
      {/* Header */}
      <header className="flex items-center gap-4 p-4 border-b bg-card shrink-0">
        <Avatar>
            <AvatarImage src={convoAvatar} />
            <AvatarFallback>
            {selectedConversation.type === 'group' ? <Users className="h-5 w-5"/> : convoFallback}
            </AvatarFallback>
        </Avatar>
        <div>
            <h3 className="font-semibold">
                {convoName}
            </h3>
            {selectedConversation.type === 'group' && (
                <p className="text-xs text-muted-foreground">{selectedConversation.chat.members.length} members</p>
            )}
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-grow p-4 bg-muted/20" viewportRef={scrollAreaViewport}>
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
                    : "bg-card rounded-bl-none shadow-sm"
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
      <div className="p-4 border-t bg-card shrink-0">
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

function NewGroupChatDialog({ onGroupCreated }: { onGroupCreated: (group: GroupChat) => void; }) {
    const { data: members, loading: membersLoading } = useMembers();
    const { user } = useCurrentUser();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<z.infer<typeof groupChatFormSchema>>({
        resolver: zodResolver(groupChatFormSchema),
        defaultValues: {
            name: "",
            members: [],
        },
    });

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewImage(reader.result as string);
          form.setValue('avatar', reader.result as string);
        };
        reader.readAsDataURL(file);
      }
    };

    const onSubmit = (values: z.infer<typeof groupChatFormSchema>) => {
        if (!user) return;
        const newGroupChat: GroupChat = {
            id: Date.now().toString(),
            name: values.name,
            members: [...values.members, user.email],
            messages: [],
            avatar: values.avatar || `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
        };
        onGroupCreated(newGroupChat);
        toast({ title: "Group chat created!" });
        setIsOpen(false);
        form.reset();
        setPreviewImage(null);
    };
    
    if (!user) return null;

    const availableMembers = members.filter(m => m.email !== user.email);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) {
                form.reset();
                setPreviewImage(null);
            }
        }}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon">
                    <Plus className="w-5 h-5" />
                    <span className="sr-only">New Group Chat</span>
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create a new group chat</DialogTitle>
                    <DialogDescription>
                        Select members to start a new conversation.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <div className="space-y-4 py-4">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <Avatar className="w-20 h-20 text-3xl">
                                    <AvatarImage src={previewImage || undefined}/>
                                    <AvatarFallback>
                                        <Users/>
                                    </AvatarFallback>
                                </Avatar>
                                <Button type="button" size="icon" className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full" onClick={() => fileInputRef.current?.click()}>
                                  <Plus className="h-4 w-4"/>
                                </Button>
                                <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageChange} />
                            </div>
                            <div className="flex-grow">
                                <Label htmlFor="group-name">Group Name</Label>
                                <Input id="group-name" {...form.register('name')} placeholder="e.g., Event Planning"/>
                                {form.formState.errors.name && <p className="text-sm text-destructive mt-1">{form.formState.errors.name.message}</p>}
                            </div>
                        </div>

                        <div className="space-y-2">
                             <Label>Members</Label>
                             {form.formState.errors.members && <p className="text-sm text-destructive">{form.formState.errors.members.message}</p>}
                             <ScrollArea className="max-h-40 w-full rounded-md border p-2">
                             {membersLoading ? (
                                <p>Loading members...</p>
                             ) : availableMembers.length > 0 ? (
                                availableMembers.map(member => (
                                <div key={member.email} className="flex items-center space-x-3 py-2">
                                    <Checkbox
                                        id={`member-${member.email}`}
                                        onCheckedChange={(checked) => {
                                            const currentMembers = form.getValues('members');
                                            const newMembers = checked 
                                                ? [...currentMembers, member.email]
                                                : currentMembers.filter(email => email !== member.email);
                                            form.setValue('members', newMembers, { shouldValidate: true });
                                        }}
                                        checked={form.watch('members').includes(member.email)}
                                    />
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src={member.avatar} />
                                        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <label htmlFor={`member-${member.email}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                        {member.name}
                                    </label>
                                </div>
                             ))) : (
                                <p className="text-sm text-muted-foreground">No other members in this club.</p>
                             )}
                            </ScrollArea>
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

function MessagesPageComponent() {
  const { user, loading: userLoading } = useCurrentUser();
  const { data: members, loading: membersLoading } = useMembers();
  const { data: allMessages, updateData: setAllMessages, loading: messagesLoading } = useMessages();
  const { data: groupChats, updateData: setGroupChats, loading: groupsLoading } = useGroupChats();
  const [searchQuery, setSearchQuery] = useState("");
  const searchParams = useSearchParams();

  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  useEffect(() => {
    const recipientEmail = searchParams.get('recipient');
    if (recipientEmail && members.length > 0 && !selectedConversation) {
      const recipientMember = members.find(m => m.email === recipientEmail);
      if (recipientMember) {
        setSelectedConversation({ type: 'dm', partner: recipientMember });
      }
    }
  }, [searchParams, members, selectedConversation]);

  const handleGroupCreated = (newGroup: GroupChat) => {
    setGroupChats((prev) => {
        const updatedChats = [...(prev || []), newGroup];
        setSelectedConversation({ type: 'group', chat: newGroup });
        return updatedChats;
    });
  };
  
   const handleSendMessage = (newMessage: Message) => {
    if (!user || !selectedConversation) return;

    if (selectedConversation.type === 'dm') {
      const dmKey = [user.email, selectedConversation.partner.email].sort().join(':');
      setAllMessages(prev => {
        const updatedDms = { ...prev };
        if (!updatedDms[dmKey]) {
            updatedDms[dmKey] = [];
        }
        updatedDms[dmKey] = [...updatedDms[dmKey], newMessage];
        return updatedDms;
      });
    } else { // group chat
      setGroupChats((prevChats) => {
        return prevChats.map(chat => {
            if (chat.id === selectedConversation.chat.id) {
            return { ...chat, messages: [...chat.messages, newMessage] };
            }
            return chat;
        });
      });
    }
  };

  const getUnreadCount = useCallback((convo: Conversation): number => {
    if (!user || !allMessages || !groupChats) return 0;
    if (convo.type === 'dm') {
        const dmKey = [user.email, convo.partner.email].sort().join(':');
        const messages = allMessages[dmKey] || [];
        return messages.filter(m => m.sender !== user.email && m.readBy && !m.readBy.includes(user.email)).length;
    } else { // group
        return convo.chat.messages.filter(m => m.sender !== user.email && m.readBy && !m.readBy.includes(user.email)).length;
    }
  }, [user, allMessages, groupChats]);
  
  const getLastMessage = useCallback((convo: Conversation): Message | null => {
      if (!user || !allMessages || !groupChats) return null;
       if (convo.type === 'dm') {
          const dmKey = [user.email, convo.partner.email].sort().join(':');
          const messages = allMessages[dmKey] || [];
          return messages.length > 0 ? messages[messages.length - 1] : null;
      } else { // group
          return convo.chat.messages.length > 0 ? convo.chat.messages[convo.chat.messages.length - 1] : null;
      }
  }, [user, allMessages, groupChats]);

  const sortedAndFilteredConversations = useMemo(() => {
    if (!user) return [];
    
    const directMessagePartners = members.filter(m => m.email !== user.email);
  
    const dmConversations: Conversation[] = directMessagePartners.map(partner => ({
        type: 'dm',
        partner
    }));
    
    const groupConversations: Conversation[] = (groupChats || [])
      .filter(chat => chat && chat.members && chat.members.includes(user.email))
      .map(chat => ({
          type: 'group',
          chat
      }));

    let allConversations = [...groupConversations, ...dmConversations];
    
    allConversations = allConversations.filter(convo => {
      const name = convo.type === 'dm' ? convo.partner.name : convo.chat.name;
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return allConversations.sort((a, b) => {
        const lastMsgA = getLastMessage(a);
        const lastMsgB = getLastMessage(b);
        if (!lastMsgA && !lastMsgB) return 0;
        if (!lastMsgA) return 1;
        if (!lastMsgB) return -1;
        return new Date(lastMsgB.timestamp).getTime() - new Date(lastMsgA.timestamp).getTime();
    });
  }, [user, members, groupChats, allMessages, searchQuery, getLastMessage]);


  if (userLoading || membersLoading || messagesLoading || groupsLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;
  }
  
  if (!user) {
    return <div>Please log in to view messages.</div>;
  }

  return (
    <div className="grid grid-cols-[300px_1fr] h-full gap-0 overflow-hidden">
      <aside className="flex flex-col bg-card border rounded-l-xl border-r">
        <header className="p-4 border-b flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold">Chats</h2>
           <NewGroupChatDialog onGroupCreated={handleGroupCreated} />
        </header>
        <div className="p-2 border-b shrink-0">
            <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search" className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {sortedAndFilteredConversations.map((convo) => {
              const unreadCount = getUnreadCount(convo);
              const lastMessage = getLastMessage(convo);
              const isSelected = selectedConversation?.type === convo.type && (
                  (selectedConversation.type === 'dm' && convo.type === 'dm' && selectedConversation.partner.email === convo.partner.email) ||
                  (selectedConversation.type === 'group' && convo.type === 'group' && selectedConversation.chat.id === convo.chat.id)
              );
              
              const convoName = convo.type === 'dm' ? convo.partner.name : convo.chat.name;
              const convoAvatar = convo.type === 'dm' ? convo.partner.avatar : convo.chat.avatar;
              const fallbackInitial = convoName.charAt(0);

              return (
                <div
                  key={convo.type === 'dm' ? convo.partner.email : convo.chat.id}
                  onClick={() => setSelectedConversation(convo)}
                  className={cn(
                    "flex items-center gap-4 p-3 cursor-pointer hover:bg-muted/50 rounded-lg",
                    isSelected && "bg-muted"
                  )}
                >
                  <Avatar>
                    <AvatarImage src={convoAvatar} />
                    <AvatarFallback>
                      {convo.type === 'group' ? <Users className="w-4 h-4"/> : fallbackInitial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-grow truncate">
                    <h4 className="font-semibold truncate">{convoName}</h4>
                    {lastMessage && <p className={cn("text-xs truncate", unreadCount > 0 ? "text-primary font-bold" : "text-muted-foreground")}>{lastMessage.text}</p>}
                  </div>
                  {unreadCount > 0 && (
                    <div className="bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                      {unreadCount}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </aside>
      <main className="h-full overflow-hidden">
        <MessagesContent 
            selectedConversation={selectedConversation}
            onSendMessage={handleSendMessage}
        />
      </main>
    </div>
  );
}

// Wrapping the component to use Suspense for searchParams
export default function MessagesPage() {
    return (
        <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}>
            <div className="h-[calc(100vh-8rem)]">
                <MessagesPageComponent />
            </div>
        </React.Suspense>
    )
}
