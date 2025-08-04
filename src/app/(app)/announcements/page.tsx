
"use client";

import { useState, useEffect, useRef } from "react";
import { Megaphone, Loader2, Pencil, Download, Paperclip, X, File as FileIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import ReactMarkdown from 'react-markdown';
import { useRouter } from "next/navigation";

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
import { useAnnouncements, useCurrentUserRole, useCurrentUser } from "@/lib/data-hooks";
import type { Announcement, Attachment } from "@/lib/mock-data";


const promptFormSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
  attachments: z.array(z.custom<Attachment>()).optional(),
});

const announcementFormSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters long."),
    content: z.string().min(10, "Content must be at least 10 characters long."),
});

export default function AnnouncementsPage() {
  const { data: announcements, updateData: setAnnouncements, loading } = useAnnouncements();
  const [isLoading, setIsLoading] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const { toast } = useToast();
  const { canEditContent } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const [clubName, setClubName] = useState("");
  const [printableContent, setPrintableContent] = useState<any>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [generatedAnnouncement, setGeneratedAnnouncement] = useState<GenerateClubAnnouncementOutput | null>(null);
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);


  useEffect(() => {
    const clubId = localStorage.getItem('selectedClubId');
    if(clubId) {
      const clubs = JSON.parse(localStorage.getItem('clubs') || '[]');
      const currentClub = clubs.find((c: any) => c.id === clubId);
      if(currentClub) {
        setClubName(currentClub.name);
      }
    }
  }, []);

  useEffect(() => {
    // Mark all announcements as read when the page is viewed
    if (announcements && announcements.some(a => !a.read)) {
        const updatedAnnouncements = announcements.map(a => ({ ...a, read: true }));
        setAnnouncements(updatedAnnouncements);
    }
  }, [announcements, setAnnouncements]);
  
  useEffect(() => {
    if (printableContent && isDownloading) {
      const generatePdf = async () => {
        const html2pdf = (await import('html2pdf.js')).default;
        const element = document.getElementById(`print-announcement-${printableContent.id}`);
        if (element) {
          const opt = {
            margin: 0,
            filename: 'meeting-slides.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
          };
          html2pdf().from(element).set(opt).save();
        }
        setPrintableContent(null);
        setIsDownloading(false);
      }
      generatePdf();
    }
  }, [printableContent, isDownloading]);


  const promptForm = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      prompt: "",
      attachments: [],
    },
  });

  const announcementForm = useForm<z.infer<typeof announcementFormSchema>>({
    resolver: zodResolver(announcementFormSchema),
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newAttachments: Attachment[] = [];
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          newAttachments.push({
            name: file.name,
            dataUri: reader.result as string,
            type: file.type,
          });
          if (newAttachments.length === files.length) {
            const allAttachments = [...attachments, ...newAttachments];
            setAttachments(allAttachments);
            promptForm.setValue("attachments", allAttachments);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeAttachment = (index: number) => {
    const newAttachments = [...attachments];
    newAttachments.splice(index, 1);
    setAttachments(newAttachments);
    promptForm.setValue("attachments", newAttachments);
  }
  
  const handleEditClick = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    announcementForm.reset({
        title: announcement.title,
        content: announcement.content,
    });
  };
  
  const handleDialogClose = () => {
    setEditingAnnouncement(null); 
    setIsPostDialogOpen(false); 
    setGeneratedAnnouncement(null);
  }

  const handleUpdateAnnouncement = (values: z.infer<typeof announcementFormSchema>) => {
    if (!editingAnnouncement) return;
    const updatedAnnouncements = announcements.map((ann) =>
        ann.id === editingAnnouncement.id ? { ...ann, ...values } : ann
    );
    setAnnouncements(updatedAnnouncements);
    toast({ title: "Announcement updated!" });
    handleDialogClose();
  };
  
  const handleDownloadSlides = async (announcement: Announcement) => {
    setPrintableContent(announcement);
    setIsDownloading(true);
  };
  
  const handleDownloadAttachment = (attachment: Attachment) => {
    const link = document.createElement("a");
    link.href = attachment.dataUri;
    link.download = attachment.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (values: z.infer<typeof promptFormSchema>) => {
    setIsLoading(true);
    try {
      const result: GenerateClubAnnouncementOutput = await generateClubAnnouncement({
        prompt: values.prompt,
      });
      setGeneratedAnnouncement(result);
      announcementForm.reset({
          title: result.title,
          content: result.announcement
      });
      setIsPostDialogOpen(true);
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

  const handlePostAnnouncement = (values: z.infer<typeof announcementFormSchema>) => {
    if (!user) return;
    const newAnnouncement: Announcement = {
        id: announcements.length > 0 ? Math.max(...announcements.map(a => a.id)) + 1 : 1,
        title: values.title,
        content: values.content,
        author: user?.name || "Club Admin",
        date: new Date().toLocaleDateString(),
        attachments: attachments,
        read: false,
    };
    setAnnouncements([newAnnouncement, ...announcements]);
    toast({ title: "Announcement posted successfully!" });
    promptForm.reset();
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    handleDialogClose();
  };
  
  return (
    <>
    <div className="grid gap-8 md:grid-cols-3">
      {canEditContent && (
        <div className="md:col-span-1">
            <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Megaphone /> Create Announcement</CardTitle>
                <CardDescription>Describe the announcement you want to create.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...promptForm}>
                <form onSubmit={promptForm.handleSubmit(handleSubmit)} className="space-y-4">
                    <FormField
                    control={promptForm.control}
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
                    <FormItem>
                      <FormLabel>Attachments (Optional)</FormLabel>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                            <Paperclip className="mr-2" />
                            Add Files
                        </Button>
                        <FormControl>
                            <Input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            onChange={handleFileChange}
                            multiple
                            />
                        </FormControl>
                      </div>
                    </FormItem>

                    {attachments.length > 0 && (
                      <div className="space-y-2">
                          {attachments.map((file, index) => (
                          <div key={index} className="flex items-center justify-between text-sm p-2 bg-muted rounded-md">
                              <div className="flex items-center gap-2 truncate">
                                <FileIcon className="h-4 w-4 shrink-0" />
                                <span className="truncate">{file.name}</span>
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeAttachment(index)}>
                                  <X className="h-4 w-4"/>
                              </Button>
                          </div>
                          ))}
                      </div>
                    )}

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
      <div className={canEditContent ? "md:col-span-2" : "md:col-span-3"}>
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
                            {announcement.author} - {clubName} - {announcement.date}
                            </CardDescription>
                        </div>
                        {canEditContent && (
                            <Button variant="ghost" size="icon" onClick={() => handleEditClick(announcement)}>
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {announcement.content}
                    </p>
                    {announcement.attachments && announcement.attachments.length > 0 && (
                        <div>
                            <h4 className="font-semibold text-sm mb-2">Attachments</h4>
                            <div className="space-y-2">
                                {announcement.attachments.map((file, index) => (
                                    <div key={index} className="flex items-center justify-between text-sm p-2 border rounded-md">
                                        <div className="flex items-center gap-2 truncate">
                                            <FileIcon className="h-4 w-4 shrink-0" />
                                            <span className="truncate">{file.name}</span>
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={() => handleDownloadAttachment(file)}>
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                  </CardContent>
                    <CardFooter className="flex-col items-start gap-2">
                        {announcement.slides && announcement.slides.length > 0 && (
                            <Button
                                variant="outline"
                                onClick={() => handleDownloadSlides(announcement)}
                                disabled={isDownloading && printableContent?.id === announcement.id}
                            >
                                {isDownloading && printableContent?.id === announcement.id ? <Loader2 className="animate-spin" /> : <Download className="mr-2" />}
                                Download Associated Slides (PDF)
                            </Button>
                        )}
                    </CardFooter>
                </Card>
              ))
          ) : (
            <Card className="flex items-center justify-center py-12">
              <CardContent>
                <p className="text-muted-foreground">No announcements yet. {canEditContent && "Create one to get started!"}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    
    <Dialog open={!!editingAnnouncement || isPostDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{editingAnnouncement ? "Edit Announcement" : "Review and Post Announcement"}</DialogTitle>
                {!editingAnnouncement && (
                    <DialogDescription>Review the AI-generated announcement below. You can make edits before posting.</DialogDescription>
                )}
            </DialogHeader>
            <Form {...announcementForm}>
                <form 
                    id="announcement-form"
                    onSubmit={announcementForm.handleSubmit(editingAnnouncement ? handleUpdateAnnouncement : handlePostAnnouncement)}
                    className="space-y-4"
                >
                    <FormField
                        control={announcementForm.control}
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
                        control={announcementForm.control}
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
                </form>
            </Form>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={handleDialogClose}>Cancel</Button>
                <Button type="submit" form="announcement-form">
                    {editingAnnouncement ? "Save Changes" : "Post Announcement"}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <div className="hidden">
    {printableContent && (
            <div id={`print-announcement-${printableContent.id}`} className="print:block">
            {printableContent.slides.map((slide: any, index: number) => (
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
