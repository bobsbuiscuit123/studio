
"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useMembers, useCurrentUser, useMessages, useGroupChats } from '@/lib/data-hooks';
import type { Member, Message, GroupChat, GroupMessage } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { SendHorizonal, ArrowLeft, MessageSquare, Users, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';


const messageFormSchema = z.object({
  text: z.string().min(1, "Message cannot be empty."),
});

const groupChatFormSchema = z.object({
  name: z.string().min(3, "Group name must be at least 3 characters."),
  members: z.array(z.string()).min(1, "You must select at least one member."),
});

function MessagesContent() {
  const { data: members, loading: membersLoading } = useMembers();
  const { user, loading: userLoading } = useCurrentUser();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const [selectedConversation, setSelectedConversation] = useState<{ type: 'dm' | 'group', id: string } | null>(null);
  
  const { allMessages, updateData: setAllMessages, data: dmMessages, setConversation: setDmConversation } = useMessages(user?.email);
  const { data: groupChats, updateData: setGroupChats } = useGroupChats();

  const viewportRef = useRef<HTMLDivElement>(null);

  const messageForm = useForm<z.infer<typeof messageFormSchema>>({
    resolver: zodResolver(messageFormSchema),
    defaultValues: { text: "" },
  });

  const groupForm = useForm<z.infer<typeof groupChatFormSchema>>({
    resolver: zodResolver(groupChatFormSchema),
    defaultValues: { name: "", members: [] },
  });

  const markDmAsRead = useCallback((recipientEmail: string) => {
    if (!user || !allMessages) return;
    
    let wasMessageUpdated = false;
    const updatedMessages = allMessages.map((msg) => {
      if (msg.senderEmail === recipientEmail && msg.recipientEmail === user.email && !msg.read) {
        wasMessageUpdated = true;
        return { ...msg, read: true };
      }
      return msg;
    });

    if (wasMessageUpdated) {
        setAllMessages(updatedMessages);
    }
  }, [user, allMessages, setAllMessages]);

  const markGroupAsRead = useCallback((groupId: string) => {
    if(!user) return;
    const updatedGroups = groupChats.map(g => {
      if (g.id === groupId) {
        return { ...g, unreadFor: (g.unreadFor || []).filter(email => email !== user.email) };
      }
      return g;
    });
    setGroupChats(updatedGroups);
  }, [user, groupChats, setGroupChats]);


  useEffect(() => {
    if (selectedConversation?.type === 'dm') {
      markDmAsRead(selectedConversation.id);
    } else if (selectedConversation?.type === 'group') {
      markGroupAsRead(selectedConversation.id);
    }
  }, [selectedConversation, markDmAsRead, markGroupAsRead]);

  // Effect to handle initial conversation selection from URL or default
  useEffect(() => {
    if (!membersLoading && !userLoading && members.length > 0 && user) {
      const recipientEmail = searchParams.get('recipient');
      if (recipientEmail) {
        const memberToSelect = members.find((m: Member) => m.email === recipientEmail) || null;
        if(memberToSelect) {
            handleSelectConversation('dm', memberToSelect.email);
        }
      }
    }
  }, [searchParams, members, user, membersLoading, userLoading]);
  
  useEffect(() => {
    if (viewportRef.current) {
        setTimeout(() => {
            if (viewportRef.current) {
                viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
            }
        }, 0);
    }
  }, [dmMessages, groupChats, selectedConversation]);

  const handleSendMessage = (values: z.infer<typeof messageFormSchema>) => {
    if (!user || !selectedConversation) return;

    if (selectedConversation.type === 'dm') {
        const newMessage: Message = {
            id: Date.now().toString(),
            senderEmail: user.email,
            recipientEmail: selectedConversation.id,
            text: values.text,
            timestamp: new Date(),
            read: false,
        };
        setAllMessages([...allMessages, newMessage]);
    } else if (selectedConversation.type === 'group') {
        const newMessage: GroupMessage = {
            id: Date.now().toString(),
            senderEmail: user.email,
            authorName: user.name,
            authorAvatar: user.avatar,
            text: values.text,
            timestamp: new Date(),
        };
        const updatedGroups = groupChats.map(g => {
            if (g.id === selectedConversation.id) {
                const membersToMarkUnread = g.memberEmails.filter(email => email !== user.email);
                return { ...g, messages: [...g.messages, newMessage], unreadFor: [...new Set([...(g.unreadFor || []), ...membersToMarkUnread])] };
            }
            return g;
        });
        setGroupChats(updatedGroups);
    }
    
    messageForm.reset();
  };
  
  const handleSelectConversation = (type: 'dm' | 'group', id: string) => {
    setSelectedConversation({ type, id });
    if (type === 'dm') {
      setDmConversation(id);
    }
  };

  const handleCreateGroup = (values: z.infer<typeof groupChatFormSchema>) => {
    if (!user) return;
    const newGroup: GroupChat = {
        id: `group_${Date.now()}`,
        name: values.name,
        memberEmails: [...values.members, user.email],
        messages: [],
        unreadFor: values.members,
    };
    setGroupChats([...groupChats, newGroup]);
    toast({ title: "Group chat created!", description: `You created the group "${values.name}".`});
    groupForm.reset();
    return true; // Indicate success to close dialog
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
  const selectedGroup = selectedConversation?.type === 'group' 
    ? groupChats.find(g => g.id === selectedConversation.id)
    : null;
  const selectedMember = selectedConversation?.type === 'dm'
    ? members.find(m => m.email === selectedConversation.id)
    : null;

  const currentMessages = selectedConversation?.type === 'group'
    ? selectedGroup?.messages || []
    : dmMessages;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] border rounded-lg h-[calc(100vh-10rem)]">
      {/* Conversation List */}
      <div className={cn("border-r bg-muted/40 flex flex-col", selectedConversation && "hidden md:flex")}>
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-semibold">Conversations</h2>
           <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon"><Plus/></Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create a New Group Chat</DialogTitle>
                    <DialogDescription>Name your group and select members to add.</DialogDescription>
                </DialogHeader>
                 <Form {...groupForm}>
                    <form 
                        onSubmit={groupForm.handleSubmit((values) => {
                           const success = handleCreateGroup(values);
                           if (success) {
                             const closeButton = document.getElementById('close-group-dialog');
                             closeButton?.click();
                           }
                        })}
                        className="space-y-4"
                    >
                        <FormField
                            control={groupForm.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <Label>Group Name</Label>
                                    <FormControl>
                                      <Input {...field} placeholder="e.g., Event Planning Committee" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={groupForm.control}
                            name="members"
                            render={() => (
                                <FormItem>
                                    <Label>Members</Label>
                                    <ScrollArea className="h-48 border rounded-md p-2">
                                    {otherMembers.map(member => (
                                        <FormField
                                            key={member.email}
                                            control={groupForm.control}
                                            name="members"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-start space-x-3 space-y-0 py-2">
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value?.includes(member.email)}
                                                            onCheckedChange={(checked) => {
                                                                return checked
                                                                    ? field.onChange([...(field.value || []), member.email])
                                                                    : field.onChange(field.value?.filter(value => value !== member.email));
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <Label className="font-normal">{member.name}</Label>
                                                </FormItem>
                                            )}
                                        />
                                    ))}
                                    </ScrollArea>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <DialogClose asChild><Button id="close-group-dialog" type="button" variant="ghost">Cancel</Button></DialogClose>
                            <Button type="submit">Create Group</Button>
                        </DialogFooter>
                    </form>
                 </Form>
            </DialogContent>
           </Dialog>
        </div>
        <ScrollArea className="flex-1">
          {membersLoading ? <p className="p-4">Loading...</p> : (
            <>
            {groupChats.map(group => {
              const hasUnread = user ? (group.unreadFor || []).includes(user.email) : false;
              return (
                 <div
                    key={group.id}
                    className={cn(
                    "flex items-center gap-3 p-3 cursor-pointer hover:bg-muted relative",
                    selectedConversation?.id === group.id && "bg-muted"
                    )}
                    onClick={() => handleSelectConversation('group', group.id)}
                >
                    {hasUnread && <span className="absolute left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />}
                    <Avatar className="h-10 w-10">
                        <AvatarFallback><Users/></AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                    <p className={cn("font-semibold", hasUnread && "font-bold")}>{group.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{group.memberEmails.length} members</p>
                    </div>
                </div>
              );
            })}

            {otherMembers.map((member) => {
              const hasUnread = allMessages.some(msg => msg.senderEmail === member.email && msg.recipientEmail === user?.email && !msg.read);
              return (
              <div
                key={member.email}
                className={cn(
                  "flex items-center gap-3 p-3 cursor-pointer hover:bg-muted relative",
                  selectedConversation?.id === member.email && "bg-muted"
                )}
                onClick={() => handleSelectConversation('dm', member.email)}
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
                    Direct Message
                  </p>
                </div>
              </div>
            )})
            }
            </>
          )}
        </ScrollArea>
      </div>

      {/* Chat Window */}
      <div className={cn("flex flex-col", !selectedConversation && "hidden md:flex")}>
        {selectedConversation ? (
          <>
            <div className="flex items-center gap-4 p-3 border-b flex-shrink-0">
               <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSelectedConversation(null)}>
                  <ArrowLeft />
                </Button>
              <Avatar className="h-10 w-10">
                {selectedConversation.type === 'dm' && selectedMember && <>
                    <AvatarImage src={selectedMember.avatar} />
                    <AvatarFallback style={{backgroundColor: stringToColor(selectedMember.name)}}>
                        {getAvatarFallback(selectedMember.name)}
                    </AvatarFallback>
                </>}
                 {selectedConversation.type === 'group' && <>
                    <AvatarFallback><Users/></AvatarFallback>
                </>}
              </Avatar>
              <div>
                <h3 className="text-lg font-semibold">{selectedMember?.name || selectedGroup?.name}</h3>
                <p className="text-sm text-muted-foreground">
                    {selectedMember?.role || (selectedGroup ? `${selectedGroup.memberEmails.length} members` : '')}
                </p>
              </div>
            </div>
            <ScrollArea className="flex-1" viewportRef={viewportRef}>
              <div className="space-y-4 p-4">
                {currentMessages.map((msg) => {
                  const sender = selectedConversation.type === 'group' ? members.find(m => m.email === (msg as GroupMessage).senderEmail) : (msg as Message).senderEmail === user?.email ? user : selectedMember;
                  const senderName = selectedConversation.type === 'group' ? (msg as GroupMessage).authorName : sender?.name;
                  const senderAvatar = selectedConversation.type === 'group' ? (msg as GroupMessage).authorAvatar : sender?.avatar;

                  return (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex items-end gap-2",
                      msg.senderEmail === user?.email ? "justify-end" : "justify-start"
                    )}
                  >
                     {msg.senderEmail !== user?.email && (
                       <Avatar className="h-8 w-8">
                         <AvatarImage src={senderAvatar} />
                          <AvatarFallback style={{backgroundColor: stringToColor(senderName || "")}}>
                            {getAvatarFallback(senderName)}
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
                      {selectedConversation.type === 'group' && msg.senderEmail !== user?.email && (
                          <p className="text-xs font-semibold mb-1">{senderName}</p>
                      )}
                      <p>{msg.text}</p>
                       <p className={cn("text-xs mt-1 text-right", msg.senderEmail === user?.email ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
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
                )})}
              </div>
            </ScrollArea>
            <div className="p-4 bg-background border-t flex-shrink-0">
               <form onSubmit={messageForm.handleSubmit(handleSendMessage)} className="flex items-center gap-2">
                <Input
                  {...messageForm.register('text')}
                  placeholder="Type a message..."
                  autoComplete="off"
                  className="flex-1"
                />
                <Button type="submit" size="icon">
                  <SendHorizonal />
                </Button>
              </form>
               {messageForm.formState.errors.text && (
                  <p className="text-destructive text-sm mt-1">{messageForm.formState.errors.text.message}</p>
                )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <MessageSquare className="h-16 w-16 mb-4" />
            <h2 className="text-2xl font-semibold">Your Messages</h2>
            <p>Select a conversation to start chatting.</p>
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

    