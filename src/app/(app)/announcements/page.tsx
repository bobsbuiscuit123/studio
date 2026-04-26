
"use client";

import { Suspense, useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { Megaphone, Loader2, Pencil, Download, Paperclip, X, File as FileIcon, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import ReactMarkdown from 'react-markdown';
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { GenerateClubAnnouncementOutput } from "@/ai/flows/generate-announcement";
import { useToast } from "@/hooks/use-toast";
import { notifyOrgAiUsageChanged, useAnnouncements, useCurrentUserRole, useCurrentUser, useMembers, useForms } from "@/lib/data-hooks";
import type { Announcement, Attachment, ClubForm } from "@/lib/mock-data";
import { openAssistantWithContext } from "@/lib/assistant/prefill";
import { AssistantInlineTrigger } from "@/components/assistant/assistant-inline-trigger";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { findPolicyViolation, policyErrorMessage } from "@/lib/content-policy";
import { cn } from "@/lib/utils";

const isNativeApp = Capacitor.isNativePlatform();

const promptFormSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
  attachments: z.array(z.custom<Attachment>()).optional(),
});

const announcementFormSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters long."),
    content: z.string().min(10, "Content must be at least 10 characters long."),
});

const isInstructionLikeAnnouncementTitle = (value?: string | null) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return true;
  return /^(send|write|draft|create|post)\b/.test(text) || /\bannouncement\b/.test(text);
};

const deriveAnnouncementTitleFromContent = (content?: string | null, fallback?: string | null) => {
  const firstLine =
    String(content ?? '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean) ?? '';
  const cleaned = firstLine
    .replace(/^(reminder|announcement)\s*:\s*/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  const fallbackText = String(fallback ?? '').trim();
  const value = cleaned || fallbackText || 'Announcement';
  return value.length > 80 ? `${value.slice(0, 77).trimEnd()}...` : value;
};

const normalizeAnnouncementForDisplay = <T extends { title?: string | null; content?: string | null }>(
  announcement: T
) => {
  const nextTitle = isInstructionLikeAnnouncementTitle(announcement.title)
    ? deriveAnnouncementTitleFromContent(announcement.content, announcement.title)
    : String(announcement.title ?? '');
  return {
    ...announcement,
    title: nextTitle,
  };
};

const isImageAttachment = (attachment: Attachment) => {
  const attachmentType = String(attachment.type ?? "").toLowerCase();
  if (attachmentType.startsWith("image/")) {
    return true;
  }

  const dataUri = String(attachment.dataUri ?? "").toLowerCase();
  if (dataUri.startsWith("data:image/")) {
    return true;
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(attachment.name ?? ""));
};

function AnnouncementsPageInner() {
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]";
  const {
    data: announcements,
    updateData: setAnnouncements,
    updateDataAsync: setAnnouncementsAsync,
    error,
    loading,
    refreshData,
    clubId,
  } = useAnnouncements();
  const {
    data: forms,
    loading: formsLoading,
    updateData: setForms,
    updateDataAsync: setFormsAsync,
    clubId: formsClubId,
  } = useForms();
  const [isLoading, setIsLoading] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const { toast } = useToast();
  const { canEditContent } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { data: members } = useMembers();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [printableContent, setPrintableContent] = useState<any>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [generatedAnnouncement, setGeneratedAnnouncement] = useState<GenerateClubAnnouncementOutput | null>(null);
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const safeForms = useMemo(() => (Array.isArray(forms) ? forms : []), [forms]);
  const memberNameByEmail = useMemo(() => {
    const list = Array.isArray(members) ? members : [];
    return new Map(list.map(member => [member.email, member.name]));
  }, [members]);
  const resolveMemberName = (value: string) =>
    memberNameByEmail.get(value) || value;
  const [showAi, setShowAi] = useState(false);
  const [handledFormId, setHandledFormId] = useState<string | null>(null);
  const [linkedFormIdDraft, setLinkedFormIdDraft] = useState<string | null>(null);
  const [highlightedAnnouncementId, setHighlightedAnnouncementId] = useState<string | null>(null);
  const aiRequestInFlightRef = useRef(false);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const openAnnouncementAssistant = (prompt: string) => {
    openAssistantWithContext(prompt);
  };

  useEffect(() => {
    if (!clubId) return;
    const load = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('name')
        .eq('id', clubId)
        .maybeSingle();
      if (!error && data?.name) setClubName(data.name);
    };
    load();
  }, [clubId, supabase]);

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

  useEffect(() => {
    if (!user?.email) return;
    const userEmail = user.email;
    setAnnouncements(prev => {
      const list = Array.isArray(prev) ? prev : [];
      let modified = false;
      const next = list.map(ann => {
        const viewedBy = Array.isArray(ann.viewedBy) ? ann.viewedBy : [];
        const alreadyViewed = viewedBy.includes(userEmail);
        if (alreadyViewed && ann.read) {
          return ann;
        }
        modified = true;
        const nextViewed = alreadyViewed ? viewedBy : [...viewedBy, userEmail];
        return { ...ann, viewedBy: nextViewed, read: true };
      });
      return modified ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);


  const promptForm = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      prompt: "",
      attachments: [],
    },
  });

  const announcementForm = useForm<z.infer<typeof announcementFormSchema>>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: {
      title: "",
      content: "",
    },
  });

  useEffect(() => {
    if (!Array.isArray(safeAnnouncements) || safeAnnouncements.length === 0) return;
    setAnnouncements(prev => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.length === 0) return prev;
      const normalizedAnnouncements = list.map(normalizeAnnouncementForDisplay);
      const changed = normalizedAnnouncements.some(
        (announcement, index) => announcement.title !== list[index]?.title
      );
      return changed ? (normalizedAnnouncements as Announcement[]) : prev;
    });
  }, [safeAnnouncements, setAnnouncements]);

  useEffect(() => {
    if (!canEditContent) return;
    const announceFormId = searchParams.get('announceFormId');
    if (!announceFormId || announceFormId === handledFormId || formsLoading) return;
    const targetForm = safeForms.find((form: ClubForm) => form.id === announceFormId);
    if (!targetForm) return;

    const prefillFromForm = async () => {
      setHandledFormId(announceFormId);
      setLinkedFormIdDraft(targetForm.id);
      setAttachments([]);

      const promptText = targetForm.title
        ? `Draft an announcement telling members to fill out the form "${targetForm.title}". Include this link in the body: /forms?formId=${encodeURIComponent(targetForm.id)}`
        : `Draft an announcement telling members to fill out this form. Include this link in the body: /forms?formId=${encodeURIComponent(targetForm.id)}`;

      openAnnouncementAssistant(promptText);
      toast({
        title: "Assistant opened",
        description: "Finish the announcement in the assistant preview before posting.",
      });
      router.replace("/announcements");
    };

    prefillFromForm();
  }, [announcementForm, canEditContent, handledFormId, formsLoading, safeForms, searchParams, toast]);

  useEffect(() => {
    const announcementId = searchParams.get('announcementId');
    if (!announcementId || loading) return;

    const targetAnnouncement = safeAnnouncements.find(
      announcement => String(announcement.id) === announcementId
    );

    if (!targetAnnouncement) {
      toast({
        title: 'Announcement unavailable',
        description: 'This item is no longer available.',
        variant: 'destructive',
      });
      router.replace('/announcements');
      return;
    }

    setHighlightedAnnouncementId(announcementId);
    const element = document.getElementById(`announcement-${announcementId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const timeoutId = window.setTimeout(() => setHighlightedAnnouncementId(current =>
      current === announcementId ? null : current
    ), 3000);

    return () => window.clearTimeout(timeoutId);
  }, [loading, router, safeAnnouncements, searchParams, toast]);

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
    const normalizedAnnouncement = normalizeAnnouncementForDisplay(announcement);
    setEditingAnnouncement(normalizedAnnouncement as Announcement);
    announcementForm.reset({
        title: normalizedAnnouncement.title,
        content: announcement.content,
    });
  };
  
  const handleDialogClose = () => {
    setEditingAnnouncement(null); 
    setIsPostDialogOpen(false); 
    setGeneratedAnnouncement(null);
    if (linkedFormIdDraft) {
      setLinkedFormIdDraft(null);
      setAttachments([]);
    }
  }

  const handleUpdateAnnouncement = async (values: z.infer<typeof announcementFormSchema>) => {
    if (!editingAnnouncement) return;
    setIsSavingAnnouncement(true);
    const saved = await setAnnouncementsAsync(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map((ann) =>
        ann.id === editingAnnouncement.id ? { ...ann, ...values, recipients: undefined } : ann
      );
    });
    setIsSavingAnnouncement(false);
    if (!saved) {
      toast({
        title: "Failed to update announcement",
        description: "Your changes were not saved. Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Announcement updated!" });
    handleDialogClose();
  };
  
  const handleDownloadSlides = async (announcement: Announcement) => {
    setPrintableContent(announcement);
    setIsDownloading(true);
  };
  
  const handleDownloadAttachment = async (attachment: Attachment) => {
    if (attachment.type === "button" && attachment.dataUri) {
      router.push(attachment.dataUri);
      return;
    }

    if (isNativeApp) {
      try {
        const { base64Data, mimeType } = extractAttachmentBase64(attachment.dataUri);
        const safeFileName = buildAttachmentFileName(attachment.name, mimeType);
        const path = `announcements/${Date.now()}-${safeFileName}`;
        const file = await Filesystem.writeFile({
          path,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        });

        await Share.share({
          title: attachment.name,
          text: "Save or share this attachment",
          url: file.uri,
          dialogTitle: "Save or share attachment",
        });
        return;
      } catch (error) {
        console.error("Native attachment download failed", error);
        toast({
          title: "Couldn't open attachment",
          description: "Please try again.",
          variant: "destructive",
        });
        return;
      }
    }

    const link = document.createElement("a");
    link.href = attachment.dataUri;
    link.download = attachment.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (values: z.infer<typeof promptFormSchema>) => {
    openAnnouncementAssistant(values.prompt);
    promptForm.reset();
    setShowAi(false);
  };

  const handlePostAnnouncement = async (values: z.infer<typeof announcementFormSchema>) => {
    if (!user) return;
    const newId = Date.now();
    const attachmentsToSave = (() => {
      if (linkedFormIdDraft) {
        const alreadyHasButton = attachments.some(att => att.type === 'button');
        if (!alreadyHasButton) {
          return [
            ...attachments,
            {
              name: "Fill out the form",
              dataUri: `/forms?formId=${encodeURIComponent(linkedFormIdDraft)}`,
              type: "button",
            },
          ];
        }
      }
      return attachments;
    })();
    const newAnnouncement: Announcement = {
        id: newId,
        title: values.title,
        content: values.content,
        author: user?.name || "Group Admin",
        date: new Date().toISOString(),
        viewedBy: user.email ? [user.email] : [],
        attachments: attachmentsToSave,
        read: false,
        linkedFormId: linkedFormIdDraft || undefined,
    };
    const violation = findPolicyViolation(newAnnouncement);
    if (violation) {
      toast({
        title: "Announcement blocked",
        description: policyErrorMessage,
        variant: "destructive",
      });
      return;
    }
    setIsSavingAnnouncement(true);
    const saved = await setAnnouncementsAsync(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const exists = list.some(a => a.id === newAnnouncement.id);
      return exists ? list : [newAnnouncement, ...list];
    });
    if (!saved) {
      setIsSavingAnnouncement(false);
      toast({
        title: "Failed to post announcement",
        description: "The announcement was not saved to your organization. Please try again.",
        variant: "destructive",
      });
      return;
    }

    if (linkedFormIdDraft && formsClubId) {
      const linkedFormId = linkedFormIdDraft;
      const formSaved = await setFormsAsync(prev => {
        const list = Array.isArray(prev) ? prev : [];
        return list.map(form =>
          form.id === linkedFormId
            ? { ...form, linkedAnnouncementId: newAnnouncement.id }
            : form
        );
      });
      if (!formSaved) {
        toast({
          title: "Announcement posted",
          description: "The announcement was saved, but the linked form reference did not persist. Please reopen the form and link it again if needed.",
          variant: "destructive",
        });
      }
      setLinkedFormIdDraft(null);
    }
    setIsSavingAnnouncement(false);
    toast({ title: "Announcement posted successfully!" });
    promptForm.reset();
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    handleDialogClose();
  };

  const formatFriendlyDate = (value: any) => {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return String(value ?? "");
  };

  const sortedAnnouncements = useMemo(() => {
    return [...safeAnnouncements.map(normalizeAnnouncementForDisplay)].sort((a: any, b: any) => {
      const aDate = new Date(a?.date ?? 0).getTime();
      const bDate = new Date(b?.date ?? 0).getTime();
      return bDate - aDate;
    });
  }, [safeAnnouncements]);
  
  return (
    <>
    <div className="tab-page-shell">
      <div className="tab-page-content">
    <div className="grid gap-4 pt-2 md:grid-cols-3 md:gap-6">
      {canEditContent && (
        <div className="md:col-span-1">
            <Card>
            <CardHeader>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <CardTitle className="flex items-center gap-2"><Megaphone /> Create Announcement</CardTitle>
                    <AssistantInlineTrigger
                      onClick={() => {
                        setShowAi(false);
                        openAnnouncementAssistant("Make and send an announcement regarding the following:");
                      }}
                    />
                  </div>
                  <CardDescription>Start manually, or fill with AI.</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {!showAi && (
                <Form {...announcementForm}>
                  <form 
                      id="announcement-manual"
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

                <div className="flex justify-end">
                  <Button type="submit">
                    {editingAnnouncement ? "Save Changes" : "Post"}
                  </Button>
                </div>
                  </form>
                  </Form>
              )}

              {showAi && (
                <Form {...promptForm}>
                  <form onSubmit={promptForm.handleSubmit(handleSubmit)} className="space-y-4">
                      <FormField
                      control={promptForm.control}
                      name="prompt"
                      render={({ field }) => (
                          <FormItem>
                          <FormLabel>Assistant prompt</FormLabel>
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

                      <Button type="submit" disabled={isLoading} className={`w-full ${aiSparkle}`}>
                      {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" /> Continue in Assistant
                          </>
                      )}
                      </Button>
                  </form>
                </Form>
              )}
            </CardContent>
            </Card>
        </div>
      )}
      <div className={canEditContent ? "md:col-span-2" : "md:col-span-3"}>
        <div className="flex flex-col gap-4">
          {loading ? <p>Loading...</p> : 
            error && safeAnnouncements.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="tab-empty-state gap-3">
                    <p className="text-muted-foreground">{error}</p>
                    <Button variant="outline" onClick={() => void refreshData()}>
                      Try again
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) :
            safeAnnouncements.length > 0 ? (
              sortedAnnouncements.map((announcement) => {
                const hasButtonAttachment = Array.isArray(announcement.attachments) && announcement.attachments.some(att => att.type === 'button');
                const viewedByList = Array.isArray(announcement.viewedBy)
                  ? announcement.viewedBy.filter((v): v is string => typeof v === "string")
                  : [];
                const viewedByNames = viewedByList.map(resolveMemberName);
                return (
                  <Card
                    key={announcement.id}
                    id={`announcement-${announcement.id}`}
                    className={cn(
                      "scroll-mt-24 transition-shadow",
                      highlightedAnnouncementId === String(announcement.id) &&
                        "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
                    )}
                  >
                    <CardHeader>
                      <div className="flex justify-between items-start">
                          <div>
                              <CardTitle>
                                {isInstructionLikeAnnouncementTitle(announcement.title)
                                  ? deriveAnnouncementTitleFromContent(announcement.content, announcement.title)
                                  : announcement.title}
                              </CardTitle>
                              <CardDescription>
                              {announcement.author} - {clubName} - {formatFriendlyDate(announcement.date)}
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
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold">Audience:</span> Everyone
                      </div>
                      {announcement.linkedFormId && !hasButtonAttachment && (
                        <div className="flex items-center gap-2">
                          <Link href={`/forms?formId=${announcement.linkedFormId}`}>
                            <Button size="sm" variant="outline" className={aiSparkle}>
                              Go to form
                            </Button>
                          </Link>
                          <span className="text-xs text-muted-foreground">This announcement links to a form.</span>
                        </div>
                      )}
                      {canEditContent && (
                        <details className="text-xs text-muted-foreground space-y-1">
                          <summary className="cursor-pointer text-sm font-semibold">
                            See views ({viewedByList.length})
                          </summary>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {viewedByNames.map(name => (
                              <Badge key={name} variant="secondary">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        </details>
                      )}
                      {Array.isArray(announcement.attachments) && announcement.attachments.length > 0 && (
                          <div>
                              <h4 className="font-semibold text-sm mb-2">Attachments</h4>
                              <div className="space-y-2">
                                  {announcement.attachments.map((file, index) => {
                                    const isButton = file.type === "button";
                                    const isImage = !isButton && isImageAttachment(file);
                                    return (
                                      <div key={index} className="space-y-3 rounded-md border p-3">
                                          <div className="flex items-center justify-between gap-3 text-sm">
                                            <div className="flex min-w-0 items-center gap-2 truncate">
                                                {isButton ? <Megaphone className="h-4 w-4 shrink-0" /> : <FileIcon className="h-4 w-4 shrink-0" />}
                                                <span className="truncate">{file.name}</span>
                                            </div>
                                            {isButton ? (
                                              <Button size="sm" className={aiSparkle} onClick={() => handleDownloadAttachment(file)}>
                                                Open form
                                              </Button>
                                            ) : (
                                              <Button variant="ghost" size="icon" onClick={() => handleDownloadAttachment(file)}>
                                                  <Download className="h-4 w-4" />
                                              </Button>
                                            )}
                                          </div>
                                          {isImage ? (
                                            <div className="overflow-hidden rounded-lg border bg-muted/30 p-2">
                                              <Image
                                                src={file.dataUri}
                                                alt={file.name}
                                                width={1200}
                                                height={900}
                                                unoptimized
                                                className="mx-auto max-h-52 w-auto max-w-full rounded-md object-contain"
                                              />
                                            </div>
                                          ) : null}
                                      </div>
                                    );
                                  })}
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
                );
              })
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="tab-empty-state">
                  <p className="text-muted-foreground">No announcements yet.</p>
                  {canEditContent ? (
                    <p className="text-muted-foreground">Create one to update your members.</p>
                  ) : (
                    <p className="text-muted-foreground">Check back soon for updates from your admins.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
      </div>
    </div>
    
    <Dialog open={!!editingAnnouncement || isPostDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="top-16 max-h-[calc(100dvh-5rem)] sm:top-[50%] sm:max-h-[calc(100dvh-2rem)]">
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
                {!editingAnnouncement && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    This announcement will be posted to everyone in the group.
                  </div>
                )}
            </form>
        </Form>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={handleDialogClose}>Cancel</Button>
                <Button type="submit" form="announcement-form" disabled={isSavingAnnouncement}>
                    {isSavingAnnouncement ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : editingAnnouncement ? "Save Changes" : "Post Announcement"}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <div className="hidden">
    {printableContent && Array.isArray(printableContent.slides) && (
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

function extractAttachmentBase64(dataUri: string) {
  const [meta, base64Data = ""] = dataUri.split(",");
  const mimeType = meta.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  if (!base64Data) {
    throw new Error("Missing attachment data.");
  }
  return { base64Data, mimeType };
}

function buildAttachmentFileName(fileName: string, mimeType: string) {
  const trimmedName = fileName.trim() || "attachment";
  if (/\.[A-Za-z0-9]+$/.test(trimmedName)) {
    return trimmedName.replace(/[^\w.\-() ]+/g, "_");
  }

  const extension = mimeTypeToExtension(mimeType);
  const safeBase = trimmedName.replace(/[^\w.\-() ]+/g, "_");
  return `${safeBase}.${extension}`;
}

function mimeTypeToExtension(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("word")) return "doc";
  if (mimeType.includes("officedocument.wordprocessingml")) return "docx";
  if (mimeType.includes("plain")) return "txt";
  if (mimeType.includes("csv")) return "csv";
  return mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "bin";
}

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<div>Loading announcements...</div>}>
      <AnnouncementsPageInner />
    </Suspense>
  );
}
