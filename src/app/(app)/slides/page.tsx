"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Presentation, Clipboard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateMeetingSlides } from "@/ai/flows/generate-meeting-slides";
import { useCurrentUserRole } from "@/lib/data-hooks";

const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

export default function SlidesPage() {
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
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

  if (role && role === 'Member') {
    return (
        <div className="flex items-center justify-center h-full">
            <Card className="p-8 text-center">
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>This page is only available to club administrators.</CardDescription>
            </Card>
        </div>
    )
  }

  return (
    <div className="grid md:grid-cols-3 gap-8">
      <div className="md:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Presentation /> Generate Slides</CardTitle>
            <CardDescription>
              Describe the meeting content you want to generate slides for.
            </CardDescription>
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
                          placeholder="e.g., Create slides for the Innovators Club meeting on July 26. Key updates are the new project launch and the upcoming hackathon. Action items are to sign up for the hackathon and submit project ideas."
                          className="min-h-[150px]"
                          {...field} 
                        />
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
              <Textarea
                className="prose prose-sm dark:prose-invert max-w-none p-4 bg-muted rounded-md h-full overflow-auto whitespace-pre-wrap break-words"
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
              />
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
