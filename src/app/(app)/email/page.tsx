
"use client";

import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Mail, Loader2, Wand2, Users, ExternalLink } from "lucide-react";

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
import { generateEmail } from "@/ai/flows/generate-email";


const promptFormSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const emailFormSchema = z.object({
  subject: z.string().min(5, "Subject must be at least 5 characters long."),
  body: z.string().min(20, "Email body must be at least 20 characters long."),
});

export default function EmailPage() {
  const { data: members, loading: membersLoading } = useMembers();
  const { role } = useCurrentUserRole();
  const { toast } = useToast();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [emailContent, setEmailContent] = useState({ subject: '', body: '' });

  const promptForm = useForm<z.infer<typeof promptFormSchema>>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: { prompt: "" },
  });

  const emailForm = useForm<z.infer<typeof emailFormSchema>>({
    resolver: zodResolver(emailFormSchema),
    values: emailContent, // Use state to control form values
    defaultValues: {
        subject: '',
        body: '',
    }
  });

  const handleGenerateDraft = async (values: z.infer<typeof promptFormSchema>) => {
    setIsGenerating(true);
    try {
      const result = await generateEmail(values);
      setEmailContent({
        subject: result.subject,
        body: result.body,
      });
      toast({ title: "Email draft generated!" });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate email draft.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };
  
  const gmailLink = useMemo(() => {
    const recipientEmails = members.map(m => m.email);
    if (recipientEmails.length === 0 || !emailContent.subject || !emailContent.body) {
      return "";
    }
    
    const bcc = recipientEmails.join(',');
    const subject = encodeURIComponent(emailContent.subject);
    const body = encodeURIComponent(emailContent.body);
    
    const baseUrl = 'https://mail.google.com/mail/?view=cm&fs=1';
    const link = `${baseUrl}&bcc=${bcc}&su=${subject}&body=${body}`;

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

  const isEmailReady = useMemo(() => {
    // Manually trigger validation to ensure form state is up-to-date with state
    emailForm.trigger(); 
    return emailForm.formState.isValid && members.length > 0 && gmailLink !== "#";
  }, [emailForm, members, gmailLink]);
  
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
    <div className="grid md:grid-cols-3 gap-8 items-start">
        {/* Step 1: Prompt */}
        <Card className="md:col-span-1 sticky top-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wand2 /> 1. Draft with AI</CardTitle>
                <CardDescription>Describe the email you want to send to all club members.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...promptForm}>
                    <form onSubmit={promptForm.handleSubmit(handleGenerateDraft)} className="space-y-4">
                        <FormField
                            control={promptForm.control}
                            name="prompt"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Prompt</FormLabel>
                                    <FormControl>
                                        <Textarea 
                                            placeholder="e.g., Write an email to remind everyone about the upcoming bake sale this Friday. Mention we still need volunteers."
                                            className="min-h-[150px]"
                                            {...field} 
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" disabled={isGenerating} className="w-full">
                            {isGenerating ? <Loader2 className="animate-spin" /> : "Generate Draft"}
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>

        {/* Step 2: Review and Send */}
        <Card className="md:col-span-2">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Mail /> 2. Review and Send</CardTitle>
                <CardDescription>Review the AI-generated draft below. You can make edits before opening it in Gmail.</CardDescription>
            </CardHeader>
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
                                                setEmailContent(prev => ({...prev, subject: e.target.value}));
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
                                                setEmailContent(prev => ({...prev, body: e.target.value}));
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
                            className={!isEmailReady || membersLoading ? 'pointer-events-none' : ''}
                          >
                            <Button 
                                type="button"
                                disabled={!isEmailReady || membersLoading} 
                                className="w-full"
                            >
                                <ExternalLink />
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
                        ? `This email will be addressed to all ${members.length} members of the club.`
                        : "There are currently no members in this club."
                    }
                 </div>
            </CardFooter>
        </Card>
    </div>
  );
}
