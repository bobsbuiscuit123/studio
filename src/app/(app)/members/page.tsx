"use client";

import { MessageSquare, Mail, PlusCircle, UserPlus } from "lucide-react";
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
import { useMembers } from "@/lib/data-hooks";
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

const formSchema = z.object({
    name: z.string().min(2, "Name is too short"),
    email: z.string().email("Invalid email address"),
    role: z.string().min(2, "Role is too short"),
});


export default function MembersPage() {
  const { data: members, updateData: setMembers, loading } = useMembers();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", role: "Member" },
  });

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
  
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Member Directory</h1>
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
      </div>

       {loading ? <p>Loading...</p> : 
          members.length > 0 ? (
          <div className="grid gap-4 md:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {members.map((member) => (
              <Card key={member.email}>
                <CardHeader className="items-center text-center">
                  <Image
                    className="aspect-square w-24 h-24 rounded-full object-cover mb-2"
                    src={member.avatar}
                    alt={`${member.name}'s avatar`}
                    width={96}
                    height={96}
                    data-ai-hint={member.dataAiHint || 'person'}
                  />
                  <CardTitle>{member.name}</CardTitle>
                  <CardDescription>{member.role}</CardDescription>
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
            <p className="text-muted-foreground">Click "Add Member" to get started!</p>
          </div>
        )}
    </div>
  );
}
