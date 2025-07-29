
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Presentation, Download, Loader2, Copy } from "lucide-react";
import ReactMarkdown from 'react-markdown';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateMeetingSlides, GenerateMeetingSlidesOutput } from "@/ai/flows/generate-meeting-slides";
import { useCurrentUserRole } from "@/lib/data-hooks";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

declare const html2pdf: any;

const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

export default function SlidesPage() {
  const [generatedContent, setGeneratedContent] = useState<GenerateMeetingSlidesOutput | null>(null);
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
      setGeneratedContent(result);
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
  
  const handleDownload = () => {
    const element = document.getElementById('print-content');
    if (element) {
      const opt = {
        margin:       0,
        filename:     'meeting-slides.pdf',
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'landscape' }
      };
      html2pdf().from(element).set(opt).save();
    }
  };

  const handleCopyToClipboard = () => {
    if (generatedContent) {
      const textToCopy = generatedContent.slides.map(slide => `## ${slide.title}\n\n${slide.content}`).join('\n\n---\n\n');
      navigator.clipboard.writeText(textToCopy);
      toast({ title: "Copied all slide content to clipboard!" });
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
    <>
      <div id="interactive-content">
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
            <Card className="flex flex-col flex-grow">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle>Generated Slides</CardTitle>
                  <CardDescription>
                    AI-generated slides will appear here.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleDownload} disabled={!generatedContent}>
                    <Download className="mr-2 h-4 w-4"/>
                    Download as PDF
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleCopyToClipboard} disabled={!generatedContent}>
                    <Copy className="h-4 w-4"/>
                    <span className="sr-only">Copy All Content</span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-grow flex items-center justify-center min-h-[500px]">
                {isLoading && (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                )}
                {generatedContent && generatedContent.slides.length > 0 ? (
                    <Carousel className="w-full max-w-xl">
                        <CarouselContent>
                        {generatedContent.slides.map((slide, index) => (
                            <CarouselItem key={index}>
                                <Card className="w-full aspect-video flex flex-col justify-center items-center text-center p-8 bg-background shadow-lg">
                                    <h2 className="text-3xl font-bold mb-4">{slide.title}</h2>
                                    <div className="prose prose-lg dark:prose-invert">
                                        <ReactMarkdown>
                                            {slide.content}
                                        </ReactMarkdown>
                                    </div>
                                </Card>
                            </CarouselItem>
                        ))}
                        </CarouselContent>
                        <CarouselPrevious className="-left-12" />
                        <CarouselNext className="-right-12" />
                    </Carousel>
                ) : !isLoading && (
                  <div className="flex items-center justify-center h-full text-center text-muted-foreground">
                      <p>Generated slides will be displayed here.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <div className="hidden">
          <div id="print-content">
          {generatedContent && generatedContent.slides.map((slide, index) => (
              <div key={`print-${index}`} className="w-[11in] h-[8.5in] p-8 flex flex-col justify-center items-center text-center bg-card">
                    <h2 className="text-5xl font-bold mb-8">{slide.title}</h2>
                    <div className="prose prose-2xl">
                      <ReactMarkdown>{slide.content}</ReactMarkdown>
                    </div>
              </div>
          ))}
          </div>
      </div>
    </>
  );
}
