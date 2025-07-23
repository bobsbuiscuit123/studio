"use client";

import { useState } from "react";
import { PlusCircle, Loader2, Sparkles } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { announcements as initialAnnouncements } from "@/lib/mock-data";
import {
  generateClubAnnouncement,
  type GenerateClubAnnouncementOutput,
} from "@/ai/flows/generate-announcement";

const announcementSchema = z.object({
  eventTitle: z.string().min(1, "Event title is required"),
  eventDescription: z.string().min(1, "Event description is required"),
  eventDate: z.string().min(1, "Event date is required"),
  deadline: z.string().optional(),
  additionalInfo: z.string().optional(),
  announcementText: z.string().min(1, "Announcement text cannot be empty"),
});

type Announcement = (typeof initialAnnouncements)[0];

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof announcementSchema>>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      eventTitle: "",
      eventDescription: "",
      eventDate: "",
      deadline: "",
      additionalInfo: "",
      announcementText: "",
    },
  });

  const handleAiGenerate = async () => {
    const {
      eventTitle,
      eventDescription,
      eventDate,
      deadline,
      additionalInfo,
    } = form.getValues();

    if (!eventTitle || !eventDescription || !eventDate) {
      toast({
        title: "Missing Information",
        description:
          "Please fill in Event Title, Description, and Date to generate an announcement.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const result: GenerateClubAnnouncementOutput = await generateClubAnnouncement({
        eventTitle,
        eventDescription,
        eventDate,
        deadline,
        additionalInfo,
      });
      form.setValue("announcementText", result.announcement);
    } catch (error) {
      toast({
        title: "AI Generation Failed",
        description: "Could not generate announcement. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const onSubmit = (values: z.infer<typeof announcementSchema>) => {
    const newAnnouncement: Announcement = {
      id: announcements.length + 1,
      title: values.eventTitle,
      content: values.announcementText,
      author: "Alice Johnson",
      date: "Just now",
    };
    setAnnouncements([newAnnouncement, ...announcements]);
    toast({
      title: "Announcement Posted!",
      description: "Your new announcement is now live.",
    });
    form.reset();
    setIsDialogOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Announcements</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              New Announcement
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[625px]">
            <DialogHeader>
              <DialogTitle>Create New Announcement</DialogTitle>
              <DialogDescription>
                Fill in the details below or use AI to generate the announcement
                text.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    name="eventDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Event Date</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., May 30th, 2024 at 2 PM" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="eventDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe the event in a few sentences."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="deadline"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Deadline (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., RSVP by May 28th" {...field} />
                        </FormControl>
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
                          <Input
                            placeholder="e.g., Bring your own container"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <FormField
                    control={form.control}
                    name="announcementText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Announcement Text</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Your announcement will appear here..."
                            className="min-h-[150px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                   <Button type="button" variant="outline" size="sm" onClick={handleAiGenerate} disabled={isGenerating}>
                      {isGenerating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" />
                      )}
                      Generate with AI
                    </Button>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="secondary">Cancel</Button>
                  </DialogClose>
                  <Button type="submit">Post Announcement</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
  );
}
