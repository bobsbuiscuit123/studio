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
import { announcements as initialAnnouncements } from "@/lib/mock-data";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateClubAnnouncement, GenerateClubAnnouncementOutput } from "@/ai/flows/generate-announcement";
import { useToast } from "@/hooks/use-toast";

type Announcement = (typeof initialAnnouncements)[0];

const formSchema = z.object({
  eventTitle: z.string().min(1, "Event title is required."),
  eventDescription: z.string().min(1, "Event description is required."),
  eventDate: z.string().min(1, "Event date is required."),
  deadline: z.string().optional(),
  additionalInfo: z.string().optional(),
});

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      eventTitle: "",
      eventDescription: "",
      eventDate: "",
      deadline: "",
      additionalInfo: "",
    },
  });

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result: GenerateClubAnnouncementOutput = await generateClubAnnouncement(values);
      const newAnnouncement: Announcement = {
        id: announcements.length + 1,
        title: values.eventTitle,
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
            <CardDescription>Use AI to draft a new announcement for the club.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="eventTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Annual Bake Sale" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="eventDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Describe the event in detail." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="eventDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Date</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Next Friday at 2 PM" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="deadline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deadline (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Sign up by Wednesday" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="additionalInfo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional Info (Optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Any other important details" {...field} />
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
          {announcements.map((announcement) => (
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
              <CardFooter>
                <Button variant="link" className="p-0">
                  Read More
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
