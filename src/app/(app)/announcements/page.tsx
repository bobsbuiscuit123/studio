
"use client";

import { Suspense, useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { Megaphone, Loader2, Pencil, Download, Paperclip, X, File as FileIcon, Sparkles, Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { GenerateClubAnnouncementOutput } from "@/ai/flows/generate-announcement";
import { useToast } from "@/hooks/use-toast";
import { notifyOrgAiUsageChanged, useAnnouncements, useCurrentUserRole, useCurrentUser, useMembers, useForms } from "@/lib/data-hooks";
import type { Announcement, Attachment, ClubForm } from "@/lib/mock-data";
import { openAssistantWithContext } from "@/lib/assistant/prefill";
import { AssistantInlineTrigger } from "@/components/assistant/assistant-inline-trigger";
import { findPolicyViolation, policyErrorMessage } from "@/lib/content-policy";
import { tryDeleteGroupAsset, uploadGroupAsset } from "@/lib/group-assets";
import { cn } from "@/lib/utils";

const isNativeApp = Capacitor.isNativePlatform();
const isRemoteUrl = (value?: string | null) => /^https?:\/\//i.test(String(value ?? ""));

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

const normalizeMemberEmail = (value?: string | null) =>
  String(value ?? "").trim().toLowerCase();

const looksLikeEmailAddress = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

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
    orgId,
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
  const [printableContent, setPrintableContent] = useState<any>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [generatedAnnouncement, setGeneratedAnnouncement] = useState<GenerateClubAnnouncementOutput | null>(null);
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);
  const [isDeletingAnnouncement, setIsDeletingAnnouncement] = useState(false);
  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const safeForms = useMemo(() => (Array.isArray(forms) ? forms : []), [forms]);
  const memberNameByEmail = useMemo(() => {
    const list = Array.isArray(members) ? members : [];
    return new Map(
      list
        .map(member => [normalizeMemberEmail(member.email), String(member.name ?? "").trim()] as const)
        .filter(([email, name]) => Boolean(email && name))
    );
  }, [members]);
  const resolveMemberName = (value: string) => {
    const raw = String(value ?? "").trim();
    const resolved = memberNameByEmail.get(normalizeMemberEmail(raw));
    if (resolved) return resolved;

    const currentUserEmail = normalizeMemberEmail(user?.email);
    const currentUserName = String(user?.name ?? "").trim();
    if (currentUserEmail && normalizeMemberEmail(raw) === currentUserEmail && currentUserName) {
      return currentUserName;
    }

    return raw;
  };
  const resolveAnnouncementAuthorName = (value: string) => {
    const raw = String(value ?? "").trim();
    const resolved = resolveMemberName(raw);
    if (resolved && !looksLikeEmailAddress(resolved)) {
      return resolved;
    }
    return raw && !looksLikeEmailAddress(raw) ? raw : "Group Member";
  };
  const [showAi, setShowAi] = useState(false);
  const [handledFormId, setHandledFormId] = useState<string | null>(null);
  const [linkedFormIdDraft, setLinkedFormIdDraft] = useState<string | null>(null);
  const [highlightedAnnouncementId, setHighlightedAnnouncementId] = useState<string | null>(null);
  const aiRequestInFlightRef = useRef(false);
  const openAnnouncementAssistant = (prompt: string) => {
    openAssistantWithContext(prompt);
  };

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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    if (!orgId || !clubId) {
      toast({
        title: "Upload unavailable",
        description: "Please wait for the group to finish loading.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingAttachments(true);
    try {
      const newAttachments = await Promise.all(
        files.map(async file => {
          const stored = await uploadGroupAsset({
            file,
            orgId,
            groupId: clubId,
            scope: "announcement",
            fileName: file.name,
          });
          return {
            name: file.name,
            dataUri: stored.url,
            type: file.type,
          } satisfies Attachment;
        })
      );
      const allAttachments = [...attachments, ...newAttachments];
      setAttachments(allAttachments);
      promptForm.setValue("attachments", allAttachments);
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const removeAttachment = (index: number) => {
    const removed = attachments[index];
    const newAttachments = [...attachments];
    newAttachments.splice(index, 1);
    setAttachments(newAttachments);
    promptForm.setValue("attachments", newAttachments);
    if (removed?.type !== "button" && orgId && clubId) {
      void tryDeleteGroupAsset({
        url: removed.dataUri,
        orgId,
        groupId: clubId,
      });
    }
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

  const handleDeleteAnnouncement = async () => {
    if (!deletingAnnouncement) return;

    setIsDeletingAnnouncement(true);
    const announcementToDelete = deletingAnnouncement;
    const saved = await setAnnouncementsAsync(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return list.filter(ann => String(ann.id) !== String(announcementToDelete.id));
    });

    if (!saved) {
      setIsDeletingAnnouncement(false);
      toast({
        title: "Failed to delete announcement",
        description: "The announcement was not deleted. Please try again.",
        variant: "destructive",
      });
      return;
    }

    if (announcementToDelete.linkedFormId && formsClubId) {
      void setFormsAsync(prev => {
        const list = Array.isArray(prev) ? prev : [];
        return list.map(form =>
          form.id === announcementToDelete.linkedFormId
            ? { ...form, linkedAnnouncementId: undefined }
            : form
        );
      });
    }

    if (Array.isArray(announcementToDelete.attachments) && orgId && clubId) {
      announcementToDelete.attachments
        .filter(attachment => attachment.type !== "button")
        .forEach(attachment => {
          void tryDeleteGroupAsset({
            url: attachment.dataUri,
            orgId,
            groupId: clubId,
          });
        });
    }

    if (highlightedAnnouncementId === String(announcementToDelete.id)) {
      setHighlightedAnnouncementId(null);
      router.replace("/announcements");
    }

    setIsDeletingAnnouncement(false);
    setDeletingAnnouncement(null);
    toast({ title: "Announcement deleted" });
  };
  
  const handleDownloadSlides = async (announcement: Announcement) => {
    setPrintableContent(announcement);
    setIsDownloading(true);
  };
  
  const handleDownloadAttachment = async (attachment: Attachment) => {
    const attachmentUrl = typeof attachment.dataUri === "string" ? attachment.dataUri : "";
    if (!attachmentUrl) {
      toast({
        title: "Attachment unavailable",
        description: "This legacy attachment needs to be migrated to storage first.",
        variant: "destructive",
      });
      return;
    }

    if (attachment.type === "button") {
      router.push(attachmentUrl);
      return;
    }

    if (isNativeApp) {
      try {
        if (isRemoteUrl(attachmentUrl)) {
          await Share.share({
            title: attachment.name,
            text: "Save or share this attachment",
            url: attachmentUrl,
            dialogTitle: "Save or share attachment",
          });
          return;
        }

        const { base64Data, mimeType } = extractAttachmentBase64(attachmentUrl);
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
    link.href = attachmentUrl;
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
    <div className="tab-page-shell min-w-0">
      <div className="tab-page-content min-w-0">
    <div className="grid w-full min-w-0 max-w-full gap-4 overflow-x-hidden pt-2 md:grid-cols-3 md:gap-6">
      {canEditContent && (
        <div className="min-w-0 md:col-span-1">
            <Card className="min-w-0 max-w-full overflow-hidden">
            <CardHeader>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <CardTitle className="flex min-w-0 items-center gap-2 break-words"><Megaphone className="shrink-0" /> Create Announcement</CardTitle>
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
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploadingAttachments}>
                          {isUploadingAttachments ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2" />}
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
                        <div key={index} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted p-2 text-sm">
                            <div className="flex min-w-0 items-center gap-2 truncate">
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
                  <Button type="submit" disabled={isUploadingAttachments || isSavingAnnouncement}>
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
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploadingAttachments}>
                              {isUploadingAttachments ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2" />}
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
                            <div key={index} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted p-2 text-sm">
                                <div className="flex min-w-0 items-center gap-2 truncate">
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

                      <Button type="submit" disabled={isLoading || isUploadingAttachments} className={`w-full ${aiSparkle}`}>
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
      <div className={canEditContent ? "min-w-0 md:col-span-2" : "min-w-0 md:col-span-3"}>
        <div className="flex min-w-0 max-w-full flex-col gap-4">
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
                      "min-w-0 max-w-full scroll-mt-24 overflow-hidden transition-shadow",
                      highlightedAnnouncementId === String(announcement.id) &&
                        "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
                    )}
                  >
                    <CardHeader>
                      <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                              <CardTitle className="break-words text-lg font-bold text-white sm:text-xl">
                                {isInstructionLikeAnnouncementTitle(announcement.title)
                                  ? deriveAnnouncementTitleFromContent(announcement.content, announcement.title)
                                  : announcement.title}
                              </CardTitle>
                              <CardDescription className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-zinc-500">
                                <span>{resolveAnnouncementAuthorName(announcement.author)}</span>
                                <span aria-hidden="true" className="text-zinc-600">•</span>
                                <span>{formatFriendlyDate(announcement.date)}</span>
                              </CardDescription>
                          </div>
                          {canEditContent && (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleEditClick(announcement)}>
                                    <Pencil className="h-4 w-4" />
                                    <span className="sr-only">Edit announcement</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeletingAnnouncement(announcement as Announcement)}
                                  className="text-destructive hover:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    <span className="sr-only">Delete announcement</span>
                                </Button>
                              </div>
                          )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="max-w-full whitespace-pre-wrap break-words font-body text-base font-normal leading-7 text-foreground/85 [overflow-wrap:anywhere] sm:text-lg sm:leading-8 md:text-xl md:leading-snug">
                        {announcement.content}
                      </p>
                      {announcement.linkedFormId && !hasButtonAttachment && (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
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

    <AlertDialog
      open={!!deletingAnnouncement}
      onOpenChange={open => {
        if (!open && !isDeletingAnnouncement) {
          setDeletingAnnouncement(null);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the announcement for everyone in the group.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={isDeletingAnnouncement}>Cancel</Button>
          </AlertDialogCancel>
          <Button variant="destructive" onClick={handleDeleteAnnouncement} disabled={isDeletingAnnouncement}>
            {isDeletingAnnouncement ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete announcement
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

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
