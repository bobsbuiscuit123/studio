"use client";

import { useState } from "react";
import { Loader2, Sparkles, Clipboard } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  generateMeetingSlides,
  type GenerateMeetingSlidesOutput,
} from "@/ai/flows/generate-meeting-slides";

const slidesSchema = z.object({
  clubName: z.string().min(1, "Club name is required"),
  meetingDate: z.string().min(1, "Meeting date is required"),
  keyUpdates: z.string().min(1, "Key updates are required"),
  actionItems: z.string().min(1, "Action items are required"),
  additionalNotes: z.string().optional(),
});

export default function SlidesPage() {
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof slidesSchema>>({
    resolver: zodResolver(slidesSchema),
    defaultValues: {
      clubName: "Computer Science Club",
      meetingDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD
      keyUpdates: "",
      actionItems: "",
      additionalNotes: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof slidesSchema>) => {
    setIsGenerating(true);
    setGeneratedContent(null);
    try {
      const result: GenerateMeetingSlidesOutput = await generateMeetingSlides(values);
      setGeneratedContent(result.slideContent);
    } catch (error) {
      toast({
        title: "AI Generation Failed",
        description: "Could not generate slides. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleCopy = () => {
    if (generatedContent) {
      navigator.clipboard.writeText(generatedContent);
      toast({ title: "Copied to clipboard!" });
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 md:gap-8">
      <Card>
        <CardHeader>
          <CardTitle>AI Meeting Slides Generator</CardTitle>
          <CardDescription>
            Input the details for your meeting, and let AI create the slides.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                      <Input type="date" {...field} />
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
                      <Textarea placeholder="e.g., Progress on Project A, Upcoming competition details" {...field} />
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
                      <Textarea placeholder="e.g., Members to sign up for roles, Team leads to submit progress reports" {...field} />
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
                      <Input placeholder="e.g., Special guest speaker" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isGenerating} className="w-full">
                {isGenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Generate Slides
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Generated Content</CardTitle>
            <CardDescription>
              Your markdown-ready slide content will appear here.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={handleCopy} disabled={!generatedContent}>
            <Clipboard className="h-4 w-4"/>
            <span className="sr-only">Copy</span>
          </Button>
        </CardHeader>
        <CardContent className="flex-grow">
          {isGenerating && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {generatedContent && (
            <div className="prose prose-sm dark:prose-invert max-w-none p-4 bg-muted rounded-md h-full overflow-auto">
              <pre className="whitespace-pre-wrap break-words bg-transparent p-0 m-0">{generatedContent}</pre>
            </div>
          )}
           {!isGenerating && !generatedContent && (
            <div className="flex items-center justify-center h-full text-center text-muted-foreground">
                <p>Your generated content will be displayed here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
