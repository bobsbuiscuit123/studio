
'use client';

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Presentation, Download, Loader2, Copy, Eye, Trash2, Pencil } from "lucide-react";
import ReactMarkdown from 'react-markdown';


import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { generateMeetingSlides } from "@/ai/flows/generate-meeting-slides";
import { useCurrentUserRole, usePresentations } from "@/lib/data-hooks";
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
import { Presentation as PresentationType, Slide } from "@/lib/mock-data";


const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const slideFormSchema = z.object({
  title: z.string().min(1, "Title cannot be empty."),
  content: z.string().min(1, "Content cannot be empty."),
});

type EditingSlideState = {
  presentationId: number;
  slideId: string;
  slide: Slide;
};

export default function SlidesPage() {
  const [activePresentation, setActivePresentation] = useState<PresentationType | null>(null);
  const [editingSlide, setEditingSlide] = useState<EditingSlideState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { role } = useCurrentUserRole();
  const { data: presentations, updateData: setPresentations, loading: presentationsLoading } = usePresentations();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [printableContent, setPrintableContent] = useState<PresentationType | null>(null);


  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });
  
  const slideForm = useForm<z.infer<typeof slideFormSchema>>({
    resolver: zodResolver(slideFormSchema),
  });

  const handleEditSlideClick = (presentation: PresentationType, slide: Slide) => {
    setEditingSlide({
      presentationId: presentation.id,
      slideId: slide.id,
      slide: slide,
    });
    slideForm.reset({
      title: slide.title,
      content: slide.content,
    });
  };

  const handleUpdateSlide = (values: z.infer<typeof slideFormSchema>) => {
    if (!editingSlide) return;

    const updatedPresentations = presentations.map((p) => {
      if (p.id === editingSlide.presentationId) {
        return {
          ...p,
          slides: p.slides.map((s) =>
            s.id === editingSlide.slideId ? { ...s, ...values } : s
          ),
        };
      }
      return p;
    });

    setPresentations(updatedPresentations);

    const updatedActivePresentation = updatedPresentations.find(p => p.id === editingSlide.presentationId);
    if(updatedActivePresentation) {
      setActivePresentation(updatedActivePresentation);
    }
    
    toast({ title: "Slide updated!" });
    setEditingSlide(null);
  };


  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    setActivePresentation(null);
    const result = await generateMeetingSlides(values);
    if (!result.ok) {
      toast({
        title: "Error",
        description: result.error.message || "Failed to generate slides.",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }
    const newPresentation: PresentationType = {
        id: presentations.length > 0 ? Math.max(...presentations.map(p => p.id)) + 1 : 1,
        prompt: values.prompt,
        slides: result.data.slides.map((s, index) => ({...s, id: `${Date.now()}-${index}`})),
        createdAt: new Date().toLocaleDateString(),
    }
    setPresentations([newPresentation, ...presentations]);
    setActivePresentation(newPresentation);
    toast({ title: "Slides generated successfully!" });
    setIsLoading(false);
  };
  
  const handleDownload = async (presentation: PresentationType) => {
    setPrintableContent(presentation);
    // Use a timeout to ensure the printable content is rendered before generating PDF
    setTimeout(async () => {
        const element = document.getElementById(`print-content-${presentation.id}`);
        if (element) {
            const html2pdf = (await import('html2pdf.js')).default;
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
                <CardDescription>This page is only available to club administrators and officers.</CardDescription>
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
                                <Card className="w-full aspect-video flex flex-col justify-center items-center text-center p-8 bg-background shadow-lg relative">
                                    <Button variant="ghost" size="icon" className="absolute top-2 right-2" onClick={() => handleEditSlideClick(activePresentation, slide)}>
                                        <Pencil className="h-4 w-4" />
                                    </Button>
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
                      <div>
                        <p>Generated slides will be displayed here.</p>
                        <p className="text-sm">Use the form on the left to generate a new presentation or select one from your history.</p>
                      </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Dialog open={!!editingSlide} onOpenChange={() => setEditingSlide(null)}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Edit Slide</DialogTitle>
                <DialogDescription>
                    Make changes to the slide title and content below.
                </DialogDescription>
            </DialogHeader>
            <Form {...slideForm}>
                <form onSubmit={slideForm.handleSubmit(handleUpdateSlide)} className="space-y-4 pt-4">
                    <FormField
                        control={slideForm.control}
                        name="title"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Slide Title</FormLabel>
                                <FormControl>
                                    <Input {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={slideForm.control}
                        name="content"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Slide Content (Markdown supported)</FormLabel>
                                <FormControl>
                                    <Textarea className="min-h-[200px] font-mono" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setEditingSlide(null)}>Cancel</Button>
                        <Button type="submit">Save Changes</Button>
                    </DialogFooter>
                </form>
            </Form>
        </DialogContent>
      </Dialog>
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
