"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Presentation, Clipboard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateMeetingSlides } from "@/ai/flows/generate-meeting-slides";

const formSchema = z.object({
  clubName: z.string().min(1, "Club name is required."),
  meetingDate: z.string().min(1, "Meeting date is required."),
  keyUpdates: z.string().min(1, "Key updates are required."),
  actionItems: z.string().min(1, "Action items are required."),
  additionalNotes: z.string().optional(),
});

export default function SlidesPage() {
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      clubName: "The Innovators Club",
      meetingDate: "",
      keyUpdates: "",
      actionItems: "",
      additionalNotes: "",
    },
  });

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    setGeneratedContent(null);
    try {
      const result = await generateMeetingSlides(values);
      setGeneratedContent(result.slideContent);
      toast({ title: "Slides generated successfully!" });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate slides.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleCopy = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent);
      toast({ title: "Copied to clipboard!" });
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Presentation /> Generate Slides</CardTitle>
            <CardDescription>
              Create content for your next meeting's presentation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="clubName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Club Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="meetingDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meeting Date</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., July 26, 2024" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="keyUpdates"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Key Updates</FormLabel>
                      <FormControl>
                        <Textarea placeholder="What are the key updates?" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="actionItems"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Action Items</FormLabel>
                      <FormControl>
                        <Textarea placeholder="What are the action items?" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="additionalNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Any other notes?" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? <Loader2 className="animate-spin" /> : "Generate"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
      <div className="md:col-span-2">
        <Card className="flex flex-col flex-grow min-h-[600px]">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Generated Slide Content</CardTitle>
              <CardDescription>
                AI-generated content will appear here. You can copy it or edit it below.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCopy} disabled={!generatedContent}>
              <Clipboard className="h-4 w-4"/>
              <span className="sr-only">Copy</span>
            </Button>
          </CardHeader>
          <CardContent className="flex-grow">
            {isLoading && (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}
            {generatedContent && (
              <div className="prose prose-sm dark:prose-invert max-w-none p-4 bg-muted rounded-md h-full overflow-auto">
                <pre className="whitespace-pre-wrap break-words bg-transparent p-0 m-0">{generatedContent}</pre>
              </div>
            )}
            {!generatedContent && !isLoading && (
              <div className="flex items-center justify-center h-full text-center text-muted-foreground">
                  <p>Generated content will be displayed here.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
