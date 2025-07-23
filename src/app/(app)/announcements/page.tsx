"use client";

import { useState } from "react";
import { Megaphone, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateClubAnnouncement, GenerateClubAnnouncementOutput } from "@/ai/flows/generate-announcement";
import { useToast } from "@/hooks/use-toast";
import { useAnnouncements } from "@/lib/data-hooks";
import type { Announcement } from "@/lib/mock-data";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

export default function AnnouncementsPage() {
  const { data: announcements, updateData: setAnnouncements, loading } = useAnnouncements();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });

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

  return (
    <div className="grid gap-8 md:grid-cols-3">
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
      <div className="md:col-span-2">
        <h2 className="text-2xl font-bold mb-4">Recent Announcements</h2>
        <div className="flex flex-col gap-4">
          {loading ? <p>Loading...</p> : 
            announcements.length > 0 ? (
              announcements.map((announcement) => (
                <Card key={announcement.id}>
                  <CardHeader>
                    <CardTitle>{announcement.title}</CardTitle>
                    <CardDescription>
                      Posted by {announcement.author} - {announcement.date}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
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
  );
}
