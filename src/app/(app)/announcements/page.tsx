"use client";

import { useState } from "react";
import { Megaphone, Loader2, Pencil } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateClubAnnouncement, GenerateClubAnnouncementOutput } from "@/ai/flows/generate-announcement";
import { useToast } from "@/hooks/use-toast";
import { useAnnouncements, useCurrentUserRole } from "@/lib/data-hooks";
import type { Announcement } from "@/lib/mock-data";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const editFormSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters long."),
    content: z.string().min(10, "Content must be at least 10 characters long."),
});

export default function AnnouncementsPage() {
  const { data: announcements, updateData: setAnnouncements, loading } = useAnnouncements();
  const [isLoading, setIsLoading] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
  });
  
  const handleEditClick = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    editForm.reset({
        title: announcement.title,
        content: announcement.content,
    });
  };

  const handleUpdateAnnouncement = (values: z.infer<typeof editFormSchema>) => {
    if (!editingAnnouncement) return;
    const updatedAnnouncements = announcements.map((ann) =>
        ann.id === editingAnnouncement.id ? { ...ann, ...values } : ann
    );
    setAnnouncements(updatedAnnouncements);
    toast({ title: "Announcement updated!" });
    setEditingAnnouncement(null);
  };

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result: GenerateClubAnnouncementOutput = await generateClubAnnouncement(values);
      const newAnnouncement: Announcement = {
        id: announcements.length + 1,
        title: result.title,
        content: result.announcement,
        author: "AI Assistant",
        date: new Date().toLocaleDateString(),
      };
      setAnnouncements([newAnnouncement, ...announcements]);
      toast({ title: "Announcement generated successfully!" });
      form.reset();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate announcement.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const isOwner = role && role !== 'Member';

  return (
    <>
    <div className="grid gap-8 md:grid-cols-3">
      {isOwner && (
        <div className="md:col-span-1">
            <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Megaphone /> Create Announcement</CardTitle>
                <CardDescription>Describe the announcement you want to create.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                    <FormField
                    control={form.control}
                    name="prompt"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Prompt</FormLabel>
                        <FormControl>
                            <Textarea 
                            placeholder="e.g., Draft an announcement for the annual bake sale next Friday at 2 PM. We need volunteers to sign up by Wednesday."
                            className="min-h-[150px]"
                            {...field} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        "Generate"
                    )}
                    </Button>
                </form>
                </Form>
            </CardContent>
            </Card>
        </div>
      )}
      <div className={isOwner ? "md:col-span-2" : "md:col-span-3"}>
        <h2 className="text-2xl font-bold mb-4">Recent Announcements</h2>
        <div className="flex flex-col gap-4">
          {loading ? <p>Loading...</p> : 
            announcements.length > 0 ? (
              announcements.map((announcement) => (
                <Card key={announcement.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle>{announcement.title}</CardTitle>
                            <CardDescription>
                            Posted by {announcement.author} - {announcement.date}
                            </CardDescription>
                        </div>
                        {isOwner && (
                            <Button variant="ghost" size="icon" onClick={() => handleEditClick(announcement)}>
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {announcement.content}
                    </p>
                  </CardContent>
                </Card>
              ))
          ) : (
            <Card className="flex items-center justify-center py-12">
              <CardContent>
                <p className="text-muted-foreground">No announcements yet. Create one to get started!</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
     {editingAnnouncement && (
        <Dialog open={!!editingAnnouncement} onOpenChange={() => setEditingAnnouncement(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Announcement</DialogTitle>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleUpdateAnnouncement)} className="space-y-4">
                <FormField
                  control={editForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Content</FormLabel>
                      <FormControl>
                        <Textarea className="min-h-[200px]" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setEditingAnnouncement(null)}>Cancel</Button>
                  <Button type="submit">Save Changes</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
