
"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useMembers, useCurrentUser, useMessages } from '@/lib/data-hooks';
import type { Member, Message } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { SendHorizonal, ArrowLeft, MessageSquare } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const messageFormSchema = z.object({
  text: z.string().min(1, "Message cannot be empty."),
});

function MessagesContent() {
  const { data: members, loading: membersLoading } = useMembers();
  const { user, loading: userLoading } = useCurrentUser();
  const searchParams = useSearchParams();
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const { allMessages, updateData: setAllMessages, data: messages } = useMessages(user?.email, selectedMember?.email);
  const viewportRef = useRef<HTMLDivElement>(null);

  const form = useForm<z.infer<typeof messageFormSchema>>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { text: "" },
  });

  const markAllMessagesAsRead = useCallback(() => {
    if (!user || !allMessages || allMessages.length === 0) return;

    let wasMessageUpdated = false;
    const updatedMessages = allMessages.map((msg) => {
      if (msg.recipientEmail === user.email && !msg.read) {
        wasMessageUpdated = true;
        return { ...msg, read: true };
      }
      return msg;
    });
    
    if (wasMessageUpdated) {
        setAllMessages(updatedMessages);
    }
  }, [user, allMessages, setAllMessages]);

  useEffect(() => {
    if (!userLoading) {
      markAllMessagesAsRead();
    }
  }, [userLoading, allMessages, markAllMessagesAsRead]);


  useEffect(() => {
    if (!membersLoading && !userLoading) {
      const recipientEmail = searchParams.get('recipient');
      if (recipientEmail) {
        const member = members.find((m: Member) => m.email === recipientEmail);
        if (member) {
          setSelectedMember(member);
        }
      } else if (members.length > 0) {
        const otherMembers = members.filter((m: Member) => m.email !== user?.email);
        if (otherMembers.length > 0) {
          const memberWithUnread = otherMembers.find(m => allMessages.some(msg => msg.senderEmail === m.email && !msg.read));
          setSelectedMember(memberWithUnread || otherMembers[0]);
        }
      }
    }
  }, [searchParams, members, user, membersLoading, userLoading, allMessages]);
  
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (values: z.infer<typeof messageFormSchema>) => {
    if (!user || !selectedMember) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      senderEmail: user.email,
      recipientEmail: selectedMember.email,
      text: values.text,
      timestamp: new Date(),
      read: false,
    };
    setAllMessages([...allMessages, newMessage]);
    form.reset();
  };
  
  const getAvatarFallback = (name?: string | null) => name ? name.charAt(0).toUpperCase() : '';
  
  const stringToColor = (str: string) => {
    if (!str) return 'hsl(0, 0%, 80%)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  const otherMembers = members.filter((m: Member) => m.email !== user?.email);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] h-[calc(100vh-8rem)]">
      {/* Member List */}
      <div className={cn("border-r bg-muted/40 flex flex-col", selectedMember && "hidden md:flex")}>
        <div className="p-4 border-b">
          <h2 className="text-xl font-semibold">Conversations</h2>
        </div>
        <ScrollArea className="flex-1">
          {membersLoading ? <p className="p-4">Loading members...</p> : (
            otherMembers.map((member) => {
              const hasUnread = allMessages.some(msg => msg.senderEmail === member.email && msg.recipientEmail === user?.email && !msg.read);
              return (
              <div
                key={member.email}
                className={cn(
                  "flex items-center gap-3 p-3 cursor-pointer hover:bg-muted relative",
                  selectedMember?.email === member.email && "bg-muted"
                )}
                onClick={() => setSelectedMember(member)}
              >
                {hasUnread && <span className="absolute left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />}
                <Avatar className="h-10 w-10">
                    <AvatarImage src={member.avatar} />
                    <AvatarFallback style={{backgroundColor: stringToColor(member.name)}}>
                        {getAvatarFallback(member.name)}
                    </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className={cn("font-semibold", hasUnread && "font-bold")}>{member.name}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {/* Placeholder for last message */}
                  </p>
                </div>
              </div>
            )})
          )}
        </ScrollArea>
      </div>

      {/* Chat Window */}
      <div className={cn("flex flex-col", !selectedMember && "hidden md:flex")}>
        {selectedMember ? (
          <>
            <div className="flex items-center gap-4 p-3 border-b">
               <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSelectedMember(null)}>
                  <ArrowLeft />
                </Button>
              <Avatar className="h-10 w-10">
                <AvatarImage src={selectedMember.avatar} />
                 <AvatarFallback style={{backgroundColor: stringToColor(selectedMember.name)}}>
                    {getAvatarFallback(selectedMember.name)}
                 </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-lg font-semibold">{selectedMember.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedMember.role}</p>
              </div>
            </div>
            <ScrollArea className="flex-1 p-4" viewportRef={viewportRef}>
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex items-end gap-2",
                      msg.senderEmail === user?.email ? "justify-end" : "justify-start"
                    )}
                  >
                     {msg.senderEmail !== user?.email && (
                       <Avatar className="h-8 w-8">
                         <AvatarImage src={selectedMember.avatar} />
                          <AvatarFallback style={{backgroundColor: stringToColor(selectedMember.name)}}>
                            {getAvatarFallback(selectedMember.name)}
                          </AvatarFallback>
                       </Avatar>
                     )}
                    <div
                      className={cn(
                        "max-w-xs md:max-w-md lg:max-w-lg rounded-lg px-4 py-2",
                        msg.senderEmail === user?.email
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      <p>{msg.text}</p>
                       <p className={cn("text-xs mt-1", msg.senderEmail === user?.email ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                     {msg.senderEmail === user?.email && user && (
                       <Avatar className="h-8 w-8">
                         <AvatarImage src={user.avatar} />
                         <AvatarFallback style={{backgroundColor: stringToColor(user.name)}}>
                            {getAvatarFallback(user.name)}
                         </AvatarFallback>
                       </Avatar>
                     )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Separator />
            <div className="p-4 bg-background">
               <form onSubmit={form.handleSubmit(handleSendMessage)} className="flex items-center gap-2">
                <Input
                  {...form.register('text')}
                  placeholder="Type a message..."
                  autoComplete="off"
                  className="flex-1"
                />
                <Button type="submit" size="icon">
                  <SendHorizonal />
                </Button>
              </form>
               {form.formState.errors.text && (
                  <p className="text-destructive text-sm mt-1">{form.formState.errors.text.message}</p>
                )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <MessageSquare className="h-16 w-16 mb-4" />
            <h2 className="text-2xl font-semibold">Your Messages</h2>
            <p>Select a member to start a conversation.</p>
          </div>
        )}
      </div>
    </div>
  );
}


export default function MessagesPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <MessagesContent />
        </Suspense>
    )
}

    