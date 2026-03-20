
"use client";

import { Suspense, useState, useEffect, useRef, useMemo } from "react";
import { Megaphone, Loader2, Pencil, Download, Paperclip, X, File as FileIcon, Sparkles } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import ReactMarkdown from 'react-markdown';
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

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
import type { Announcement, Attachment, Member, ClubForm } from "@/lib/mock-data";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeFetchJson } from "@/lib/network";


const promptFormSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
  attachments: z.array(z.custom<Attachment>()).optional(),
});

const announcementFormSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters long."),
    content: z.string().min(10, "Content must be at least 10 characters long."),
    recipients: z.string().optional(),
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

function AnnouncementsPageInner() {
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]";
  const { data: announcements, updateData: setAnnouncements, loading, clubId } = useAnnouncements();
  const { data: forms, loading: formsLoading, updateData: setForms, clubId: formsClubId } = useForms();
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
  const safeAnnouncements = Array.isArray(announcements) ? announcements : [];
  const safeForms = useMemo(() => (Array.isArray(forms) ? forms : []), [forms]);
  const memberNameByEmail = useMemo(() => {
    const list = Array.isArray(members) ? members : [];
    return new Map(list.map(member => [member.email, member.name]));
  }, [members]);
  const resolveMemberName = (value: string) =>
    memberNameByEmail.get(value) || value;
  const [optimisticAnnouncements, setOptimisticAnnouncements] = useState<Announcement[]>([]);
  const [recipientMode, setRecipientMode] = useState<'all' | 'specific'>('all');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [showAi, setShowAi] = useState(false);
  const [handledFormId, setHandledFormId] = useState<string | null>(null);
  const [linkedFormIdDraft, setLinkedFormIdDraft] = useState<string | null>(null);
  const aiRequestInFlightRef = useRef(false);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

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
      recipients: "",
    },
  });

  const persistAnnouncement = (announcement: Announcement) => {
    setAnnouncements(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const exists = list.some(a => a.id === announcement.id);
      return exists ? list : [announcement, ...list];
    });
  };

  useEffect(() => {
    const ids = new Set(safeAnnouncements.map(a => a.id));
    setOptimisticAnnouncements(prev => prev.filter(a => !ids.has(a.id)));
  }, [safeAnnouncements]);

  useEffect(() => {
    if (!Array.isArray(safeAnnouncements) || safeAnnouncements.length === 0) return;
    const normalizedAnnouncements = safeAnnouncements.map(normalizeAnnouncementForDisplay);
    const changed = normalizedAnnouncements.some(
      (announcement, index) => announcement.title !== safeAnnouncements[index]?.title
    );
    if (!changed) return;
    setAnnouncements(normalizedAnnouncements as Announcement[]);
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
      setAttachments([{
        name: "Fill out the form",
        dataUri: `/forms?formId=${encodeURIComponent(targetForm.id)}`,
        type: "button",
      }]);
      setRecipientMode('all');
      setSelectedRecipients([]);
      setIsLoading(true);
      try {
        const promptText = targetForm.title
          ? `tell everyone to fill out this form titled "${targetForm.title}"`
          : "tell everyone to fill out this form";
        const idempotencyKey =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const result = await safeFetchJson<{ ok: true; data: GenerateClubAnnouncementOutput; error?: { message?: string } }>(
          '/api/announcements/ai',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: promptText }),
            timeoutMs: 15_000,
            retry: { retries: 0 },
            idempotencyKey,
          }
        );
        if (!result.ok) {
          toast({
            title: "Error",
            description: result.error?.message || "Failed to generate announcement for this form.",
            variant: "destructive",
          });
          return;
        }
        notifyOrgAiUsageChanged(undefined, 1);
        setGeneratedAnnouncement(result.data.data);
        announcementForm.reset({
          title: result.data.data.title,
          content: result.data.data.announcement
        });
        setIsPostDialogOpen(true);
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to generate announcement for this form.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    prefillFromForm();
  }, [announcementForm, canEditContent, handledFormId, formsLoading, safeForms, searchParams, toast]);

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
    const recips = Array.isArray(announcement.recipients) ? announcement.recipients : [];
    setRecipientMode(recips.length > 0 ? 'specific' : 'all');
    setSelectedRecipients(recips);
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

  const handleUpdateAnnouncement = (values: z.infer<typeof announcementFormSchema>) => {
    if (!editingAnnouncement) return;
    const recipients = recipientMode === 'specific' ? selectedRecipients : [];
    const updatedAnnouncements = safeAnnouncements.map((ann) =>
        ann.id === editingAnnouncement.id ? { ...ann, ...values, recipients } : ann
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
    if (attachment.type === "button" && attachment.dataUri) {
      router.push(attachment.dataUri);
      return;
    }
    const link = document.createElement("a");
    link.href = attachment.dataUri;
    link.download = attachment.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSubmit = async (values: z.infer<typeof promptFormSchema>) => {
    if (aiRequestInFlightRef.current) return;
    aiRequestInFlightRef.current = true;
    setIsLoading(true);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const result = await safeFetchJson<{ ok: true; data: GenerateClubAnnouncementOutput; error?: { message?: string } }>(
        '/api/announcements/ai',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: values.prompt }),
          timeoutMs: 15_000,
          retry: { retries: 0 },
          idempotencyKey,
        }
      );
      if (!result.ok) {
        toast({
          title: "Error",
          description: result.error?.message || "Failed to generate announcement.",
          variant: "destructive",
        });
        return;
      }
      notifyOrgAiUsageChanged(undefined, 1);
      setGeneratedAnnouncement(result.data.data);
      announcementForm.reset({
          title: result.data.data.title,
          content: result.data.data.announcement
      });
      setIsPostDialogOpen(true);
    } finally {
      aiRequestInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handlePostAnnouncement = (values: z.infer<typeof announcementFormSchema>) => {
    if (!user) return;
    const recipients = recipientMode === 'specific' ? selectedRecipients : [];
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
        recipients,
        viewedBy: user.email ? [user.email] : [],
        attachments: attachmentsToSave,
        read: false,
        linkedFormId: linkedFormIdDraft || undefined,
    };
    setAnnouncements(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const exists = list.some(a => a.id === newAnnouncement.id);
      const next = exists ? list : [newAnnouncement, ...list];
      return next as any;
    });
    setOptimisticAnnouncements(prev => {
      const exists = prev.some(a => a.id === newAnnouncement.id);
      return exists ? prev : [newAnnouncement, ...prev];
    });
    persistAnnouncement(newAnnouncement);
    if (linkedFormIdDraft) {
      setForms(prev => {
        const list = Array.isArray(prev) ? prev : [];
        return list.map(form => form.id === linkedFormIdDraft ? { ...form, linkedAnnouncementId: newAnnouncement.id } : form);
      });
      if (formsClubId) {
        setForms(prev => {
          const list = Array.isArray(prev) ? prev : [];
          return list.map(form =>
            form.id === linkedFormIdDraft
              ? { ...form, linkedAnnouncementId: newAnnouncement.id }
              : form
          );
        });
      }
      setLinkedFormIdDraft(null);
    }
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
    const merged = (() => {
      const optimisticIds = new Set(optimisticAnnouncements.map(a => a.id));
      const dedupedSafe = safeAnnouncements.filter(a => !optimisticIds.has(a.id));
      return [...optimisticAnnouncements, ...dedupedSafe].map(normalizeAnnouncementForDisplay);
    })();
    return [...merged].sort((a: any, b: any) => {
      const aDate = new Date(a?.date ?? 0).getTime();
      const bDate = new Date(b?.date ?? 0).getTime();
      return bDate - aDate;
    });
  }, [optimisticAnnouncements, safeAnnouncements]);
  
  return (
    <>
    <div className="tab-page-shell">
      <div className="tab-page-header">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Megaphone className="h-6 w-6" /> Announcements
          </h1>
          <p className="text-sm text-muted-foreground">
            Share updates with members and keep the latest posts anchored at the top.
          </p>
        </div>
      </div>
      <div className="tab-page-content pt-2">
    <div className="grid gap-4 md:grid-cols-3 md:gap-6">
      {canEditContent && (
        <div className="md:col-span-1">
            <Card>
            <CardHeader className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Megaphone /> Create Announcement</CardTitle>
                  <CardDescription>Start manually, or fill with AI.</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="default"
                  className={showAi ? '' : aiSparkle}
                  onClick={() => setShowAi(v => !v)}
                >
                  {showAi ? 'Make manually' : <><Sparkles className="h-4 w-4 mr-1" /> Make with AI</>}
                </Button>
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
                  <div className="space-y-2">
                    <FormLabel>Recipients</FormLabel>
                    <div className="flex items-center gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="recipient-mode"
                          checked={recipientMode === 'all'}
                          onChange={() => setRecipientMode('all')}
                        />
                        Send to everyone
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="recipient-mode"
                          checked={recipientMode === 'specific'}
                          onChange={() => setRecipientMode('specific')}
                        />
                        Choose recipients
                      </label>
                    </div>
                    {recipientMode === 'specific' && (
                      <div className="max-h-48 overflow-auto rounded border p-2 space-y-1">
                        {(Array.isArray(members) ? members : []).map((m: Member) => {
                          const checked = selectedRecipients.includes(m.email);
                          return (
                            <label key={m.email} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  setSelectedRecipients(prev => {
                                    if (e.target.checked) {
                                      return prev.includes(m.email) ? prev : [...prev, m.email];
                                    }
                                    return prev.filter(v => v !== m.email);
                                  });
                                }}
                              />
                              <span>{m.name}</span>
                              <span className="text-muted-foreground text-xs">({m.email})</span>
                            </label>
                          );
                        })}
                        {(Array.isArray(members) ? members : []).length === 0 && (
                          <p className="text-xs text-muted-foreground">No members found.</p>
                        )}
                      </div>
                    )}
                  </div>
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
                          <FormLabel>AI prompt</FormLabel>
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
                            <Sparkles className="h-4 w-4 mr-2" /> Generate with AI
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
            safeAnnouncements.length > 0 ? (
              sortedAnnouncements.map((announcement) => {
                const hasButtonAttachment = Array.isArray(announcement.attachments) && announcement.attachments.some(att => att.type === 'button');
                const recipientsList = Array.isArray(announcement.recipients)
                  ? announcement.recipients.filter((r): r is string => typeof r === "string")
                  : [];
                const viewedByList = Array.isArray(announcement.viewedBy)
                  ? announcement.viewedBy.filter((v): v is string => typeof v === "string")
                  : [];
                const recipientNames = recipientsList.map(resolveMemberName);
                const viewedByNames = viewedByList.map(resolveMemberName);
                return (
                  <Card key={announcement.id}>
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
                        <span className="font-semibold">Recipients:</span>{" "}
                        {recipientNames.length > 0
                          ? recipientNames.join(", ")
                          : "Everyone"}
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
                                    return (
                                      <div key={index} className="flex items-center justify-between text-sm p-2 border rounded-md">
                                          <div className="flex items-center gap-2 truncate">
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
              <CardContent className="py-10">
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
                {!editingAnnouncement && (
                  <div className="space-y-2">
                    <FormLabel>Recipients</FormLabel>
                    <div className="flex items-center gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="recipient-mode"
                          checked={recipientMode === 'all'}
                          onChange={() => setRecipientMode('all')}
                        />
                        Send to everyone
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="recipient-mode"
                          checked={recipientMode === 'specific'}
                          onChange={() => setRecipientMode('specific')}
                        />
                        Choose recipients
                      </label>
                    </div>
                    {recipientMode === 'specific' && (
                      <div className="max-h-48 overflow-auto rounded border p-2 space-y-1">
                        {(Array.isArray(members) ? members : []).map((m: Member) => {
                          const checked = selectedRecipients.includes(m.email);
                          return (
                            <label key={m.email} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  setSelectedRecipients(prev => {
                                    if (e.target.checked) {
                                      return prev.includes(m.email) ? prev : [...prev, m.email];
                                    }
                                    return prev.filter(v => v !== m.email);
                                  });
                                }}
                              />
                              <span>{m.name}</span>
                              <span className="text-muted-foreground text-xs">({m.email})</span>
                            </label>
                          );
                        })}
                        {(Array.isArray(members) ? members : []).length === 0 && (
                          <p className="text-xs text-muted-foreground">No members found.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
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

export default function AnnouncementsPage() {
  return (
    <Suspense fallback={<div>Loading announcements...</div>}>
      <AnnouncementsPageInner />
    </Suspense>
  );
}
