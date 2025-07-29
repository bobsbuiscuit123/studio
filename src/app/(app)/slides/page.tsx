
'use client';

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Presentation, Download, Loader2, Copy, Share2, Eye, Trash2 } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import html2pdf from 'html2pdf.js';


import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { generateMeetingSlides, GenerateMeetingSlidesOutput } from "@/ai/flows/generate-meeting-slides";
import { generateClubAnnouncement, GenerateClubAnnouncementOutput } from "@/ai/flows/generate-announcement";
import { useCurrentUserRole, useCurrentUser, useAnnouncements, usePresentations } from "@/lib/data-hooks";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Announcement, Presentation as PresentationType } from "@/lib/mock-data";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const shareFormSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt for the announcement."),
});

export default function SlidesPage() {
  const [activePresentation, setActivePresentation] = useState<PresentationType | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [generatedAnnouncement, setGeneratedAnnouncement] = useState<GenerateClubAnnouncementOutput | null>(null);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { data: announcements, updateData: setAnnouncements } = useAnnouncements();
  const { data: presentations, updateData: setPresentations, loading: presentationsLoading } = usePresentations();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [printableContent, setPrintableContent] = useState<PresentationType | null>(null);


  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });
  
  const shareForm = useForm<z.infer<typeof shareFormSchema>>({
    resolver: zodResolver(shareFormSchema),
    defaultValues: { prompt: "" },
  });


  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    setActivePresentation(null);
    setGeneratedAnnouncement(null);
    try {
      const result = await generateMeetingSlides(values);
      const newPresentation: PresentationType = {
          id: presentations.length > 0 ? Math.max(...presentations.map(p => p.id)) + 1 : 1,
          prompt: values.prompt,
          slides: result.slides,
          createdAt: new Date().toLocaleDateString(),
      }
      setPresentations([newPresentation, ...presentations]);
      setActivePresentation(newPresentation);
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
  
  const handleDownload = async (presentation: PresentationType) => {
    setPrintableContent(presentation);
    // Use a timeout to ensure the printable content is rendered before generating PDF
    setTimeout(() => {
        const element = document.getElementById(`print-content-${presentation.id}`);
        if (element) {
            const opt = {
                margin:       0,
                filename:     'meeting-slides.pdf',
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true },
                jsPDF:        { unit: 'in', format: 'letter', orientation: 'landscape' }
            };
            html2pdf().from(element).set(opt).save().then(() => {
                setPrintableContent(null); // Clean up after saving
            });
        }
    }, 100);
  };

  const handleCopyToClipboard = () => {
    if (activePresentation) {
      const textToCopy = activePresentation.slides.map(slide => `## ${slide.title}\n\n${slide.content}`).join('\n\n---\n\n');
      navigator.clipboard.writeText(textToCopy);
      toast({ title: "Copied all slide content to clipboard!" });
    }
  };
  
  const handleShare = async (values: z.infer<typeof shareFormSchema>) => {
    if (!activePresentation) return;
    setIsSharing(true);
    setGeneratedAnnouncement(null);
    try {
      const slidesContent = activePresentation.slides.map(s => `Slide: ${s.title}\n${s.content}`).join('\n\n');
      const announcementPrompt = `${values.prompt}\n\nHere is the content of the slides to announce:\n${slidesContent}`;
      
      const result = await generateClubAnnouncement({ prompt: announcementPrompt });
      setGeneratedAnnouncement(result);
      toast({ title: "Announcement draft generated!" });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate announcement.",
        variant: "destructive",
      });
    } finally {
      setIsSharing(false);
    }
  };

  const handlePostAnnouncement = () => {
    if (!generatedAnnouncement || !user || !activePresentation) return;
    const newAnnouncement: Announcement = {
      id: announcements.length > 0 ? Math.max(...announcements.map(a => a.id)) + 1 : 1,
      title: generatedAnnouncement.title,
      content: generatedAnnouncement.announcement,
      author: user.name,
      date: new Date().toLocaleDateString(),
      read: false,
      slides: activePresentation.slides, // Attach slide data here
    };
    setAnnouncements([newAnnouncement, ...announcements]);
    toast({ title: "Shared to announcements!" });
    setIsShareDialogOpen(false);
    setGeneratedAnnouncement(null);
    shareForm.reset();
  };

  const handleDelete = (id: number) => {
    const updatedPresentations = presentations.filter(p => p.id !== id);
    setPresentations(updatedPresentations);
    if (activePresentation?.id === id) {
        setActivePresentation(null);
    }
    toast({ title: "Presentation deleted" });
    setDeletingId(null);
  }

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
          <div className="md:col-span-1 space-y-8">
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
            <Card>
                <CardHeader>
                    <CardTitle>History</CardTitle>
                    <CardDescription>Previously generated presentations.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {presentationsLoading ? <p>Loading...</p> : presentations.length > 0 ? (
                        presentations.map(p => (
                            <div key={p.id} className="border p-3 rounded-lg flex justify-between items-center">
                                <div>
                                    <p className="font-semibold truncate w-40" title={p.prompt}>{p.prompt}</p>
                                    <p className="text-sm text-muted-foreground">{p.createdAt}</p>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => setActivePresentation(p)}><Eye/></Button>
                                     <AlertDialog open={deletingId === p.id} onOpenChange={(open) => !open && setDeletingId(null)}>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="icon" onClick={() => setDeletingId(p.id)}><Trash2 className="text-destructive"/></Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will permanently delete this presentation. This action cannot be undone.
                                            </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(p.id)}>Delete</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">No history yet.</p>
                    )}
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
                   <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="secondary" disabled={!activePresentation}>
                        <Share2 className="mr-2 h-4 w-4" />
                        Share
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Share to Announcements</DialogTitle>
                        <DialogDescription>
                          Generate an announcement for these slides and post it for the club to see. The announcement will link to a PDF of these slides.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                        <div>
                          <h3 className="font-semibold mb-2">1. Create your announcement</h3>
                          <p className="text-sm text-muted-foreground mb-4">
                            Describe the announcement you want to make about these slides. The AI will use your prompt and the slide content to generate a message.
                          </p>
                          <Form {...shareForm}>
                            <form onSubmit={shareForm.handleSubmit(handleShare)} className="space-y-4">
                              <FormField
                                control={shareForm.control}
                                name="prompt"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Announcement Prompt</FormLabel>
                                    <FormControl>
                                      <Textarea 
                                        placeholder="e.g., Announce the upcoming meeting and share these slides as a preview."
                                        className="min-h-[120px]"
                                        {...field} 
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <Button type="submit" disabled={isSharing} className="w-full">
                                {isSharing ? <Loader2 className="animate-spin" /> : "Generate Announcement"}
                              </Button>
                            </form>
                          </Form>
                        </div>
                        <div>
                          <h3 className="font-semibold mb-2">2. Review and Post</h3>
                           <p className="text-sm text-muted-foreground mb-4">
                            Review the generated announcement below. If you're happy with it, click post.
                          </p>
                          <div className="border rounded-lg p-4 bg-muted/50 min-h-[220px]">
                            {isSharing && <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}
                            {generatedAnnouncement ? (
                              <div className="space-y-2">
                                <h4 className="font-bold">{generatedAnnouncement.title}</h4>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{generatedAnnouncement.announcement}</p>
                              </div>
                            ) : !isSharing && (
                              <div className="flex items-center justify-center h-full">
                                <p className="text-sm text-center text-muted-foreground">Your generated announcement will appear here.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
                        <Button onClick={handlePostAnnouncement} disabled={!generatedAnnouncement}>Post Announcement</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button variant="outline" onClick={() => activePresentation && handleDownload(activePresentation)} disabled={!activePresentation}>
                    <Download className="mr-2 h-4 w-4"/>
                    Download as PDF
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleCopyToClipboard} disabled={!activePresentation}>
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
                {activePresentation && activePresentation.slides.length > 0 ? (
                    <Carousel className="w-full max-w-xl">
                        <CarouselContent>
                        {activePresentation.slides.map((slide, index) => (
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
                      <p className="text-sm">Use the form on the left to generate a new presentation or select one from your history.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <div className="hidden">
          {printableContent && (
             <div id={`print-content-${printableContent.id}`} className="print:block">
                {printableContent.slides.map((slide, index) => (
                    <div key={`print-${index}`} className="w-[11in] h-[8.5in] p-8 flex flex-col justify-center items-center text-center bg-card">
                          <h2 className="text-5xl font-bold mb-8">{slide.title}</h2>
                          <div className="prose prose-2xl">
                            <ReactMarkdown>{slide.content}</ReactMarkdown>
                          </div>
                    </div>
                ))}
            </div>
          )}
      </div>
    </>
  );
}
