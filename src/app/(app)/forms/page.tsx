"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { ClipboardList, Loader2, Plus, Send, Eye, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser, useCurrentUserRole, useForms, useMembers } from "@/lib/data-hooks";
import type { ClubForm, FormQuestion, FormResponse } from "@/lib/mock-data";
import { useSearchParams } from "next/navigation";

const formBuilderSchema = z.object({
  title: z.string().min(3, "Title is required"),
  description: z.string().optional(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        prompt: z.string().min(3, "Question text is required"),
        required: z.boolean().optional(),
        kind: z.enum(["shortText", "single", "multi", "file"]),
        options: z.array(z.string()).optional(),
      })
    )
    .min(1, "Add at least one question"),
});

type FormBuilderValues = z.infer<typeof formBuilderSchema>;

function FormsPageInner() {
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]";
  const { data: forms, updateData: setForms, loading } = useForms();
  const { data: members } = useMembers();
  const { user } = useCurrentUser();
  const { canEditContent, role } = useCurrentUserRole();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [responseDrafts, setResponseDrafts] = useState<Record<string, Record<string, string>>>({});
  const [resubmittingFormIds, setResubmittingFormIds] = useState<Set<string>>(new Set());

  const builderForm = useForm<FormBuilderValues>({
    resolver: zodResolver(formBuilderSchema),
    defaultValues: {
      title: "",
      description: "",
      questions: [
        { id: crypto.randomUUID(), prompt: "What do you want to ask?", required: true, kind: "shortText", options: [] },
      ],
    },
  });

  const safeForms = useMemo(() => (Array.isArray(forms) ? forms : []), [forms]);
  const memberNameByEmail = useMemo(() => {
    const list = Array.isArray(members) ? members : [];
    return new Map(list.map(member => [member.email, member.name]));
  }, [members]);
  const resolveMemberName = (email: string) =>
    memberNameByEmail.get(email) || email;
  const currentEmail = user?.email || "";

  useEffect(() => {
    const formId = searchParams.get("formId");
    if (formId) {
      setActiveFormId(formId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeFormId || !currentEmail) return;
    const form = safeForms.find(f => f.id === activeFormId);
    if (!form) return;
    const viewedBy = Array.isArray(form.viewedBy) ? form.viewedBy : [];
    if (viewedBy.includes(currentEmail)) return;
    setForms(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map(f => {
        if (f.id !== activeFormId) return f;
        return { ...f, viewedBy: [...viewedBy, currentEmail] };
      });
    });
  }, [activeFormId, currentEmail, safeForms, setForms]);

  const addQuestion = () => {
    const current = builderForm.getValues("questions");
    if (current.length >= 8) {
      toast({ title: "Limit reached", description: "Keep forms concise (max 8 questions)." });
      return;
    }
    builderForm.setValue("questions", [
      ...current,
      { id: crypto.randomUUID(), prompt: "", required: false, kind: "shortText", options: [] },
    ]);
  };

  const handleCreateForm = (values: FormBuilderValues) => {
    const newForm: ClubForm = {
      id: crypto.randomUUID(),
      title: values.title.trim(),
      description: values.description?.trim(),
      questions: values.questions.map(q => ({
        id: q.id,
        prompt: q.prompt.trim(),
        required: Boolean(q.required),
        kind: q.kind,
        options: q.options?.filter(Boolean),
      })) as FormQuestion[],
      createdAt: new Date().toISOString(),
      createdBy: currentEmail || "AI Assistant",
      viewedBy: currentEmail ? [currentEmail] : [],
      responses: [],
    };

    setForms(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return [newForm, ...list];
    });

    toast({
      title: "Form created",
      description: "You can announce or collect responses now.",
    });

    builderForm.reset({
      title: "",
      description: "",
      questions: [{ id: crypto.randomUUID(), prompt: "", required: true }],
    });
  };

  const handleSubmitResponse = (form: ClubForm) => {
    if (!currentEmail) {
      toast({ title: "Sign in required", description: "Add a user to submit responses.", variant: "destructive" });
      return;
    }
    const answers = responseDrafts[form.id] || {};
    const missingRequired = form.questions.some(q => q.required && !answers[q.id]?.trim());
    if (missingRequired) {
      toast({ title: "Required answers missing", description: "Please fill all required questions.", variant: "destructive" });
      return;
    }

    const newResponse: FormResponse = {
      id: crypto.randomUUID(),
      respondentEmail: currentEmail,
      submittedAt: new Date().toISOString(),
      answers,
    };

    setForms(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map(f => {
        if (f.id !== form.id) return f;
        const existingResponses = Array.isArray(f.responses) ? f.responses : [];
        // replace previous response from same person
        const filtered = existingResponses.filter(r => r.respondentEmail !== currentEmail);
        return { ...f, responses: [...filtered, newResponse], viewedBy: f.viewedBy?.includes(currentEmail) ? f.viewedBy : [...(f.viewedBy || []), currentEmail] };
      });
    });

    setResponseDrafts(prev => ({ ...prev, [form.id]: {} }));
    setResubmittingFormIds(prev => {
      const next = new Set(prev);
      next.delete(form.id);
      return next;
    });
    toast({ title: "Response submitted", description: "Your answers have been saved." });
  };

  const viewedCount = (form: ClubForm) => Array.isArray(form.viewedBy) ? form.viewedBy.length : 0;
  const respondedCount = (form: ClubForm) => Array.isArray(form.responses) ? form.responses.length : 0;
  const resolveOptionLabel = (value: string, options?: string[]) => {
    if (!options || options.length === 0) return value;
    const trimmed = value.trim();
    const directMatch = options.find(opt => opt === trimmed);
    if (directMatch) return directMatch;
    const match = trimmed.match(/^(?:option|choice)\s*(\d+)$/i) || trimmed.match(/^(\d+)$/);
    if (match) {
      const index = Number(match[1]) - 1;
      if (index >= 0 && index < options.length) {
        return options[index];
      }
    }
    return value;
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="header shrink-0 flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> Forms
            <span className="text-sm font-normal text-muted-foreground">Collect responses and track reads</span>
          </h1>
        </div>
      </header>

      <div className="content flex-1 flex flex-col justify-start">
      <div className="grid gap-3 lg:grid-cols-3">
        {canEditContent && (
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Create form
              </CardTitle>
              <CardDescription>Admins and officers can build a lightweight form and track reads.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={builderForm.handleSubmit(handleCreateForm)}
              >
                <div className="space-y-1">
                  <label className="text-sm font-medium">Title</label>
                  <Input {...builderForm.register("title")} placeholder="RSVP for mentorship mixer" />
                  <p className="text-xs text-destructive">{builderForm.formState.errors.title?.message}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea {...builderForm.register("description")} placeholder="Tell members why this form matters." />
                </div>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold">Questions</label>
                    <Button type="button" variant="ghost" size="sm" onClick={addQuestion}>
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </Button>
                  </div>
                  {builderForm.watch("questions").map((q, index) => (
                    <div key={q.id} className="space-y-1 rounded-md border p-2">
                      <Input
                        value={q.prompt}
                        onChange={e => builderForm.setValue(`questions.${index}.prompt`, e.target.value)}
                        placeholder={`Question ${index + 1}`}
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold">Type</label>
                        <select
                          className="text-sm border rounded px-2 py-1"
                          value={q.kind}
                          onChange={e => builderForm.setValue(`questions.${index}.kind`, e.target.value as any)}
                        >
                          <option value="shortText">Free response</option>
                          <option value="single">Select one</option>
                          <option value="multi">Select many</option>
                          <option value="file">File upload</option>
                        </select>
                      </div>
                      {(q.kind === "single" || q.kind === "multi") && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold">Answer choices</label>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const current = builderForm.getValues(`questions.${index}.options`) || [];
                                const next = current.length > 0 ? [...current, `Choice ${current.length + 1}`] : ["Choice 1"];
                                builderForm.setValue(`questions.${index}.options`, next);
                              }}
                            >
                              Add choice
                            </Button>
                          </div>
                          <div className="space-y-1">
                            {(q.options && q.options.length > 0 ? q.options : ["Choice 1", "Choice 2"]).map((opt, optIdx) => (
                              <Input
                                key={`${q.id}-opt-${optIdx}`}
                                value={opt}
                                onChange={e => {
                                  const current = builderForm.getValues(`questions.${index}.options`) || [];
                                  const normalized = current.length > 0 ? [...current] : ["Choice 1", "Choice 2"];
                                  normalized[optIdx] = e.target.value;
                                  builderForm.setValue(`questions.${index}.options`, normalized);
                                }}
                                placeholder={`Choice ${optIdx + 1}`}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={e => builderForm.setValue(`questions.${index}.required`, e.target.checked)}
                        />
                        Required
                      </div>
                      <p className="text-xs text-destructive">
                        {builderForm.formState.errors.questions?.[index]?.prompt?.message}
                      </p>
                    </div>
                  ))}
                </div>
                <Button type="submit" className={`w-full ${aiSparkle}`}>
                  <Sparkles className="h-4 w-4 mr-2" /> Publish form
                </Button>
              </form>
            </CardContent>
            </Card>
        )}

        <div className={canEditContent ? "lg:col-span-2" : "lg:col-span-3"}>
          <Card>
            <CardHeader>
              <CardTitle>Live forms</CardTitle>
              <CardDescription>Members can view, answer, and you can track reads and replies.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading forms...</p>
              ) : safeForms.length === 0 ? (
                <p className="text-muted-foreground">No forms yet. {canEditContent ? "Create one to collect responses." : ""}</p>
              ) : (
                safeForms.map(form => {
                  const responses = Array.isArray(form.responses) ? form.responses : [];
                  const isNew = currentEmail ? !(form.viewedBy || []).includes(currentEmail) : false;
                  return (
                    <Card key={form.id} className={activeFormId === form.id ? "border-primary/60 shadow" : ""}>
                      <CardHeader className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="space-y-1">
                            <CardTitle className="text-lg">{form.title}</CardTitle>
                            <CardDescription className="flex items-center gap-2 flex-wrap">
                              <span>{new Date(form.createdAt).toLocaleString()}</span>
                              <Separator orientation="vertical" className="h-4" />
                              <span>Views: {viewedCount(form)}</span>
                              <Separator orientation="vertical" className="h-4" />
                              <span>Responses: {respondedCount(form)}</span>
                              {isNew && <Badge variant="default">New</Badge>}
                            </CardDescription>
                          </div>
                          <Button variant="ghost" onClick={() => setActiveFormId(prev => (prev === form.id ? null : form.id))}>
                            <Eye className="h-4 w-4 mr-2" />
                            {activeFormId === form.id ? "Hide" : "View"}
                          </Button>
                        </div>
                        {form.description && (
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{form.description}</p>
                        )}
                      </CardHeader>
                      {activeFormId === form.id && (
                        <>
                          <CardContent className="space-y-4">
                            {(() => {
                              const hasSubmitted = currentEmail
                                ? responses.some(r => r.respondentEmail === currentEmail)
                                : false;
                              const showThankYou = hasSubmitted && !resubmittingFormIds.has(form.id);
                              if (showThankYou) {
                                return (
                                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                                    <p className="font-semibold">Thank you for your submission!</p>
                                    <p className="text-emerald-800">Your response has been saved.</p>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="mt-3"
                                      onClick={() => {
                                        setResubmittingFormIds(prev => {
                                          const next = new Set(prev);
                                          next.add(form.id);
                                          return next;
                                        });
                                        setResponseDrafts(prev => ({ ...prev, [form.id]: {} }));
                                      }}
                                    >
                                      Redo form
                                    </Button>
                                  </div>
                                );
                              }
                              return (
                                <div className="space-y-2">
                                  <h4 className="text-sm font-semibold">Questions</h4>
                                  {form.questions.map((q, index) => (
                                    <div key={q.id} className="space-y-1">
                                      <p className="text-sm font-medium">
                                        {index + 1}. {q.prompt} {q.required ? <span className="text-destructive">*</span> : null}
                                      </p>
                                      {(() => {
                                        const currentValue = responseDrafts[form.id]?.[q.id] || "";
                                        if (q.kind === "single") {
                                          return (
                                            <div className="space-y-1">
                                              {(q.options || []).map(option => (
                                                <label key={option} className="flex items-center gap-2 text-sm">
                                                  <input
                                                    type="radio"
                                                    name={`${form.id}-${q.id}`}
                                                    checked={currentValue === option}
                                                    onChange={() =>
                                                      setResponseDrafts(prev => ({
                                                        ...prev,
                                                        [form.id]: { ...(prev[form.id] || {}), [q.id]: option },
                                                      }))
                                                    }
                                                  />
                                                  {option}
                                                </label>
                                              ))}
                                            </div>
                                          );
                                        }
                                        if (q.kind === "multi") {
                                          const values = currentValue ? currentValue.split("||") : [];
                                          return (
                                            <div className="space-y-1">
                                              {(q.options || []).map(option => {
                                                const checked = values.includes(option);
                                                return (
                                                  <label key={option} className="flex items-center gap-2 text-sm">
                                                    <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      onChange={e => {
                                                        const next = e.target.checked
                                                          ? [...values, option]
                                                          : values.filter(v => v !== option);
                                                        setResponseDrafts(prev => ({
                                                          ...prev,
                                                          [form.id]: { ...(prev[form.id] || {}), [q.id]: next.join("||") },
                                                        }));
                                                      }}
                                                    />
                                                    {option}
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          );
                                        }
                                        if (q.kind === "file") {
                                          return (
                                            <Input
                                              type="file"
                                              onChange={async e => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const reader = new FileReader();
                                                reader.onload = () => {
                                                  const dataUri = typeof reader.result === "string" ? reader.result : "";
                                                  setResponseDrafts(prev => ({
                                                    ...prev,
                                                    [form.id]: { ...(prev[form.id] || {}), [q.id]: dataUri },
                                                  }));
                                                };
                                                reader.readAsDataURL(file);
                                              }}
                                            />
                                          );
                                        }
                                        return (
                                          <Textarea
                                            placeholder="Your answer"
                                            value={currentValue}
                                            onChange={e =>
                                              setResponseDrafts(prev => ({
                                                ...prev,
                                                [form.id]: { ...(prev[form.id] || {}), [q.id]: e.target.value },
                                              }))
                                            }
                                          />
                                        );
                                      })()}
                                    </div>
                                  ))}
                                  <Button size="sm" onClick={() => handleSubmitResponse(form)}>
                                    <Send className="h-4 w-4 mr-2" /> Submit response
                                  </Button>
                                </div>
                              );
                            })()}
                            <Separator />
                            {role === 'Admin' && (
                              <div className="space-y-3">
                                <details className="space-y-1">
                                  <summary className="cursor-pointer text-sm font-semibold">
                                    See views ({viewedCount(form)})
                                  </summary>
                                  <div className="space-y-1 mt-1">
                                    <p className="text-xs text-muted-foreground">
                                      Viewed by {viewedCount(form)} member(s), answered by {respondedCount(form)}.
                                    </p>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      {(form.viewedBy || []).map(email => (
                                        <Badge key={email} variant="secondary">
                                          {resolveMemberName(email)}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                </details>
                                {responses.length > 0 && (
                                  <details className="space-y-1">
                                    <summary className="cursor-pointer text-sm font-semibold">
                                      See responses ({responses.length})
                                    </summary>
                                    <div className="space-y-3 mt-1">
                                      {responses.map(resp => (
                                        <div key={resp.id} className="rounded-md border p-2">
                                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>{resolveMemberName(resp.respondentEmail)}</span>
                                            <span>{new Date(resp.submittedAt).toLocaleString()}</span>
                                          </div>
                                          <div className="mt-2 space-y-1 text-sm">
                                            {form.questions.map(q => (
                                              <div key={q.id}>
                                                <p className="font-medium">{q.prompt}</p>
                                                {q.kind === "file" && resp.answers[q.id] ? (
                                                  <a className="text-primary underline text-xs" href={resp.answers[q.id]} download>
                                                    Download upload
                                                  </a>
                                                ) : q.kind === "multi" ? (
                                                  <p className="text-muted-foreground">
                                                    {(resp.answers[q.id] || "")
                                                      .split("||")
                                                      .filter(Boolean)
                                                      .map(value => resolveOptionLabel(value, q.options))
                                                      .join(", ") || "—"}
                                                  </p>
                                                ) : (
                                                  <p className="text-muted-foreground">
                                                    {resolveOptionLabel(resp.answers[q.id] || "—", q.options)}
                                                  </p>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </>
                      )}
                    </Card>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
}

export default function FormsPage() {
  return (
    <Suspense fallback={<div>Loading forms...</div>}>
      <FormsPageInner />
    </Suspense>
  );
}
