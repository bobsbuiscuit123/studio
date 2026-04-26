
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Mail, Loader2, Wand2, Users, ExternalLink, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useMembers, useCurrentUserRole } from "@/lib/data-hooks";
import { openAssistantWithContext } from "@/lib/assistant/prefill";
import { AssistantInlineTrigger } from "@/components/assistant/assistant-inline-trigger";
import {
  ASSISTANT_EMAIL_DRAFT_EVENT,
  clearAssistantEmailDraft,
  readAssistantEmailDraft,
  type AssistantEmailDraft,
} from "@/lib/assistant/email-draft-handoff";


const promptFormSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const emailFormSchema = z.object({
  subject: z.string().min(5, "Subject must be at least 5 characters long."),
  body: z.string().min(20, "Email body must be at least 20 characters long."),
});

function EmailPageInner() {
  const searchParams = useSearchParams();
  const { data: members, loading: membersLoading } = useMembers();
  const { role } = useCurrentUserRole();
  const { toast } = useToast();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [emailContent, setEmailContent] = useState({ subject: '', body: '' });
  const [hydratedFromQuery, setHydratedFromQuery] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]";
  const applyAssistantDraft = useCallback((draft: AssistantEmailDraft) => {
    setEmailContent({
      subject: draft.subject,
      body: draft.body,
    });
    setHydratedFromQuery(true);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("subject", draft.subject);
      url.searchParams.set("body", draft.body);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const openEmailAssistant = (prompt: string) => {
    openAssistantWithContext(
      [
        "I’m on the email page for this group.",
        prompt,
        "Draft a subject and body for an email to members.",
        "Use the email action so confirming fills the email tab composer only.",
        "Do not send anything automatically.",
      ].join(" ")
    );
  };

  const promptForm = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: { prompt: "" },
  });

  const emailForm = useForm<z.infer<typeof emailFormSchema>>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: {
        subject: '',
        body: '',
    }
  });

  // Re-validate the form whenever emailContent changes
  useEffect(() => {
    emailForm.reset(emailContent);
    void emailForm.trigger();
  }, [emailContent, emailForm]);

  useEffect(() => {
    if (hydratedFromQuery) return;
    const storedDraft = readAssistantEmailDraft();
    if (storedDraft) {
      applyAssistantDraft(storedDraft);
      clearAssistantEmailDraft();
      return;
    }

    const subject = searchParams.get("subject");
    const body = searchParams.get("body");
    if (!subject && !body) return;
    setEmailContent({
      subject: subject ?? "",
      body: body ?? "",
    });
    setHydratedFromQuery(true);
  }, [applyAssistantDraft, hydratedFromQuery, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAssistantEmailDraft = (event: Event) => {
      const draft = (event as CustomEvent<{ draft?: AssistantEmailDraft }>).detail?.draft;
      if (!draft?.subject || !draft?.body) {
        return;
      }

      applyAssistantDraft(draft);
      clearAssistantEmailDraft();
    };

    window.addEventListener(ASSISTANT_EMAIL_DRAFT_EVENT, handleAssistantEmailDraft as EventListener);
    return () =>
      window.removeEventListener(ASSISTANT_EMAIL_DRAFT_EVENT, handleAssistantEmailDraft as EventListener);
  }, [applyAssistantDraft]);

  const handleGenerateDraft = async (values: z.infer<typeof promptFormSchema>) => {
    openEmailAssistant(values.prompt);
    promptForm.reset();
    setShowAi(false);
  };
  
  const gmailLink = useMemo(() => {
    const recipientEmails = members.map(m => m.email);
    if (recipientEmails.length === 0 || !emailContent.subject || !emailContent.body) {
      return "";
    }
    
    const to = recipientEmails.join(',');
    const subject = encodeURIComponent(emailContent.subject);
    const body = encodeURIComponent(emailContent.body);
    
    const baseUrl = 'https://mail.google.com/mail/?view=cm&fs=1';
    const link = `${baseUrl}&to=${to}&su=${subject}&body=${body}`;

    if (link.length > 2000) {
        toast({
            title: "Email is too long",
            description: "The generated email (including recipients) is too long to open in Gmail automatically. Please copy the content manually.",
            variant: "destructive",
            duration: 10000,
        });
        return "#"; // Return a non-functional link
    }
    return link;
  }, [emailContent, members, toast]);

  const isEmailReady = emailContent.subject && emailContent.body && members.length > 0 && gmailLink !== "#";
  
  if (role && role === 'Member') {
    return (
        <div className="tab-page-shell">
            <div className="tab-page-content">
            <Card className="p-8 text-center">
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>This page is only available to club administrators and officers.</CardDescription>
            </Card>
            </div>
        </div>
    )
  }

  return (
    <div className="tab-page-shell">
      <div className="tab-page-content">
    <div className="grid gap-6 pt-2">
      <Card>
        <CardHeader>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="flex items-center gap-2"><Mail /> Compose email</CardTitle>
              <AssistantInlineTrigger
                onClick={() => {
                  setShowAi(false);
                  openEmailAssistant("Draft an email to all members of this group.");
                }}
              />
            </div>
            <CardDescription>Start manually, then use the assistant if you want help drafting.</CardDescription>
          </div>
        </CardHeader>
        {showAi && (
          <CardContent className="border-b pb-4">
            <Form {...promptForm}>
              <form onSubmit={promptForm.handleSubmit(handleGenerateDraft)} className="space-y-4">
                <FormField
                  control={promptForm.control}
                  name="prompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assistant prompt</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g., Write an email to remind everyone about the bake sale Friday. We still need 5 volunteers."
                          className="min-h-[150px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isGenerating} className={aiSparkle}>
                  {isGenerating ? <Loader2 className="animate-spin" /> : 'Continue in Assistant'}
                </Button>
              </form>
            </Form>
          </CardContent>
        )}
        <CardContent>
          <Form {...emailForm}>
            <form className="space-y-4">
              <FormField
                control={emailForm.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setEmailContent(prev => ({ ...prev, subject: e.target.value }));
                        }}
                        placeholder="Email Subject"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={emailForm.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Body</FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[300px]"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setEmailContent(prev => ({ ...prev, body: e.target.value }));
                        }}
                        placeholder="Email Body"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <a
                href={isEmailReady ? gmailLink : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={!isEmailReady ? 'pointer-events-none' : ''}
              >
                <Button
                  type="button"
                  disabled={!isEmailReady || membersLoading}
                  className="w-full"
                >
                  <ExternalLink className="mr-2" />
                  Open in Gmail for All ({membersLoading ? '...' : members.length}) Members
                </Button>
              </a>
            </form>
          </Form>
        </CardContent>
        <CardFooter>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            {members.length > 0
              ? `This email will be addressed to all ${members.length} members of the group.`
              : "There are currently no members in this group."
            }
          </div>
        </CardFooter>
      </Card>
    </div>
      </div>
    </div>
  );
}

export default function EmailPage() {
  return (
    <Suspense fallback={<div>Loading email...</div>}>
      <EmailPageInner />
    </Suspense>
  );
}
