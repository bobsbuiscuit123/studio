
"use client";

import { MessageSquare, Mail, UserPlus, Share2 } from "lucide-react";
import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMembers, useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import type { Member } from "@/lib/mock-data";
import { useToast } from "@/hooks/use-toast";
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
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const formSchema = z.object({
    name: z.string().min(2, "Name is too short"),
    email: z.string().email("Invalid email address"),
    role: z.string().min(2, "Role is too short"),
});


export default function MembersPage() {
  const { data: members, updateData: setMembers, loading, clubId } = useMembers();
  const { toast } = useToast();
  const [joinLink, setJoinLink] = useState('');
  const { role } = useCurrentUserRole();
  const { user } = useCurrentUser();

  useEffect(() => {
    if (typeof window !== 'undefined' && clubId) {
        const url = `${window.location.origin}/?joinClubId=${clubId}`;
        setJoinLink(url);
    }
  }, [clubId]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", role: "Member" },
  });
  
  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  const handleAddMember = (values: z.infer<typeof formSchema>) => {
    const newMember: Member = {
      ...values,
      avatar: `https://placehold.co/100x100.png?text=${values.name.charAt(0)}`,
    };
    setMembers([newMember, ...members]);
    toast({ title: "Member added successfully!" });
    form.reset();
  };

  const handleMessage = (name: string) => {
    toast({
      title: "Feature not available",
      description: `Messaging for ${name} is not implemented yet.`,
    });
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(joinLink);
    toast({ title: "Copied to clipboard!" });
  };

  const isOwner = role && role !== 'Member';
  
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Member Directory</h1>
        {isOwner && (
            <div className="flex gap-2">
            <Dialog>
                <DialogTrigger asChild>
                <Button>
                    <UserPlus className="mr-2" /> Add Member
                </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add a New Member</DialogTitle>
                    <DialogDescription>
                    Enter the details for the new member.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(handleAddMember)} className="space-y-4">
                    <Input {...form.register('name')} placeholder="Full Name" />
                    {form.formState.errors.name && <p className="text-red-500 text-sm">{form.formState.errors.name.message}</p>}
                    <Input {...form.register('email')} placeholder="Email Address" />
                    {form.formState.errors.email && <p className="text-red-500 text-sm">{form.formState.errors.email.message}</p>}
                    <Input {...form.register('role')} placeholder="Role (e.g., Member, President)" />
                    {form.formState.errors.role && <p className="text-red-500 text-sm">{form.formState.errors.role.message}</p>}
                    <DialogFooter>
                    <DialogClose asChild>
                        <Button type="submit">Add Member</Button>
                    </DialogClose>
                    </DialogFooter>
                </form>
                </DialogContent>
            </Dialog>
            <Dialog>
                <DialogTrigger asChild>
                <Button variant="outline">
                    <Share2 className="mr-2" /> Invite Members
                </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Share Join Link</DialogTitle>
                    <DialogDescription>
                    Share this link with people you want to invite to your club.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Input value={joinLink} readOnly />
                </div>
                <DialogFooter>
                    <Button onClick={handleCopyToClipboard}>Copy Link</Button>
                </DialogFooter>
                </DialogContent>
            </Dialog>
            </div>
        )}
      </div>

       {loading ? <p>Loading...</p> : 
          members.length > 0 ? (
          <div className="grid gap-4 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {members.map((member) => (
              <Card key={member.email}>
                <CardHeader className="items-center text-center">
                    <Avatar className="w-24 h-24 mb-2 text-4xl">
                        <AvatarImage src={member.avatar} alt={`${member.name}'s avatar`} data-ai-hint={member.dataAiHint || 'person'} />
                        <AvatarFallback style={{ backgroundColor: member.avatar ? undefined : stringToColor(member.name)}}>
                            {member.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                  <CardTitle>{member.name}</CardTitle>
                  <CardDescription>{member.role} {member.email === user?.email && "(You)"}</CardDescription>
                </CardHeader>
                <CardContent className="text-center">
                  <a href={`mailto:${member.email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2">
                    <Mail className="h-4 w-4" />
                    {member.email}
                  </a>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" onClick={() => handleMessage(member.name)}>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Message
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
           <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <p className="text-muted-foreground">No members have been added yet.</p>
            {isOwner && <p className="text-muted-foreground">Click "Add Member" to get started!</p>}
          </div>
        )}
    </div>
  );
}
