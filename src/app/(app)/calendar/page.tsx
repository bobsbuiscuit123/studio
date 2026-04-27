
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Pencil, PlusSquare, Award, Sparkles, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useEvents, useCurrentUserRole, useCurrentUser, useMembers } from "@/lib/data-hooks";
import type { ClubEvent } from "@/lib/mock-data";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
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
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { openAssistantWithContext } from "@/lib/assistant/prefill";
import { AssistantInlineTrigger } from "@/components/assistant/assistant-inline-trigger";
import { cn } from "@/lib/utils";

const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const editFormSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters."),
    description: z.string().min(10, "Description must be at least 10 characters."),
    location: z.string().optional().or(z.literal("")),
    date: z.string(),
    points: z.coerce.number().min(0, "Points cannot be negative.").optional(),
    rsvpRequired: z.boolean().optional(),
});

type CalendarAiResponse =
  | {
      ok: true;
      data: {
        title: string;
        description: string;
        date: string;
        location?: string;
        hasTime: boolean;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
        code: string;
      };
    };

type CalendarAiEnvelope = {
  success?: boolean;
  data?: CalendarAiResponse;
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
};

const createClientEventId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const manualEventSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters."),
  description: z.string().optional().or(z.literal("")),
  location: z.string().optional().or(z.literal("")),
  date: z.string(),
  time: z.string().optional().or(z.literal("")),
  points: z.coerce.number().min(0).optional(),
  rsvpRequired: z.boolean().optional(),
});

const formatDateTimeLocalValue = (value: Date) => format(value, "yyyy-MM-dd'T'HH:mm");

const parseDateTimeLocalValue = (value: string) => {
  const [datePart, timePart = "00:00"] = String(value).split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return new Date(value);
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

const parseManualEventDateTime = (date: string, time?: string) => {
  const normalizedDate = String(date).trim();
  if (!normalizedDate) {
    return new Date();
  }

  const normalizedTime = String(time ?? "").trim() || "00:00";
  return parseDateTimeLocalValue(`${normalizedDate}T${normalizedTime}`);
};

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [isClient, setIsClient] = useState(false);
  const { data: events, updateData: setEvents, updateDataAsync: saveEvents, error, loading, refreshData } = useEvents();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [editingDraftEvent, setEditingDraftEvent] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ClubEvent | null>(null);
  const [deleteCandidateEvent, setDeleteCandidateEvent] = useState<ClubEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const { canEditContent } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { data: members } = useMembers();
  const currentEmail = user?.email || "";
  const safeEvents = Array.isArray(events) ? events : [];
  const highlightedEventId = searchParams.get("eventId");
  const [showAi, setShowAi] = useState(false);
  const aiRequestInFlightRef = useRef(false);
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]";
  const openCalendarAssistant = (prompt: string) => {
    openAssistantWithContext(prompt);
  };

  useEffect(() => {
    setIsClient(true);
    const today = new Date();
    setDate(today);
    setCurrentMonth(today);
  }, []);

  useEffect(() => {
    if (!selectedEvent) return;
    const updated = safeEvents.find(event => event.id === selectedEvent.id);
    if (updated && updated !== selectedEvent) {
      setSelectedEvent(updated);
    }
  }, [safeEvents, selectedEvent]);

  useEffect(() => {
    if (!highlightedEventId || loading) return;

    const targetEvent = safeEvents.find(event => event.id === highlightedEventId);
    if (!targetEvent) {
      toast({
        title: 'Event unavailable',
        description: 'This item is no longer available.',
        variant: 'destructive',
      });
      router.replace('/calendar');
      return;
    }

    setSelectedEvent(targetEvent);
    const element = document.getElementById(`event-${highlightedEventId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedEventId, loading, router, safeEvents, toast]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });
  const manualForm = useForm<z.infer<typeof manualEventSchema>>({
    resolver: zodResolver(manualEventSchema),
    defaultValues: {
      title: "",
      description: "",
      location: "",
      date: "",
      time: "",
      points: 0,
      rsvpRequired: false,
    },
  });
  
  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
  });

  const openEventEditor = (event: ClubEvent, options?: { isDraft?: boolean }) => {
    setEditingEvent(event);
    setEditingDraftEvent(Boolean(options?.isDraft));
    setSelectedEvent(null); // Close the details dialog if open
    editForm.reset({
      title: event.title,
      description: event.description,
      location: event.location,
      date: formatDateTimeLocalValue(event.date),
      points: event.points || 0,
      rsvpRequired: Boolean(event.rsvpRequired),
    });
  };

  const handleEditClick = (event: ClubEvent) => {
    openEventEditor(event);
  };

  const handleUpdateEvent = async (values: z.infer<typeof editFormSchema>) => {
    if (!editingEvent || savingEvent) return;
    setSavingEvent(true);
    const savedEvent: ClubEvent = {
      ...editingEvent,
      title: values.title,
      description: values.description,
      location: values.location?.trim() || "",
      date: parseDateTimeLocalValue(values.date),
      hasTime: true,
      points: values.points,
      rsvpRequired: Boolean(values.rsvpRequired),
    };

    if (editingDraftEvent) {
      const persisted = await saveEvents(prevEvents => {
        const list = Array.isArray(prevEvents) ? prevEvents : [];
        const alreadyExists = list.some(event => event.id === savedEvent.id);
        if (alreadyExists) {
          return list.map(event => (event.id === savedEvent.id ? savedEvent : event));
        }
        return [...list, savedEvent];
      });
      if (!persisted) {
        toast({
          title: "Could not add event",
          description: "The event was not saved. Please try again.",
          variant: "destructive",
        });
        setSavingEvent(false);
        return;
      }
      toast({ title: "Event added successfully!" });
    } else {
      const persisted = await saveEvents(prevEvents =>
        prevEvents.map((event) => (event.id === editingEvent.id ? savedEvent : event))
      );
      if (!persisted) {
        toast({
          title: "Could not update event",
          description: "Your changes were not saved. Please try again.",
          variant: "destructive",
        });
        setSavingEvent(false);
        return;
      }
      toast({ title: "Event updated!" });
    }

    setEditingDraftEvent(false);
    setEditingEvent(null);
    setSavingEvent(false);
  };

  const handleDeleteEvent = async () => {
    if (!deleteCandidateEvent || deletingEvent) return;

    setDeletingEvent(true);
    const eventId = deleteCandidateEvent.id;
    const eventTitle = deleteCandidateEvent.title;
    const deleted = await saveEvents(prevEvents =>
      prevEvents.filter(event => event.id !== eventId)
    );

    if (!deleted) {
      toast({
        title: "Could not delete event",
        description: "The event was not deleted. Please try again.",
        variant: "destructive",
      });
      setDeletingEvent(false);
      return;
    }

    setDeleteCandidateEvent(null);
    setSelectedEvent(current => (current?.id === eventId ? null : current));
    setEditingEvent(current => (current?.id === eventId ? null : current));
    setEditingDraftEvent(false);
    setDeletingEvent(false);
    toast({
      title: "Event deleted",
      description: `${eventTitle} was removed from the calendar.`,
    });
  };

  const markEventViewed = (eventId: string) => {
    if (!currentEmail) return;
    setEvents(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map(ev => {
        if (ev.id !== eventId) return ev;
        const viewedBy = Array.isArray(ev.viewedBy) ? ev.viewedBy : [];
        if (viewedBy.includes(currentEmail)) {
          return ev.read ? ev : { ...ev, read: true };
        }
        return { ...ev, viewedBy: [...viewedBy, currentEmail], read: true };
      });
    });
  };

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const memberNameByEmail = useMemo(() => {
    const list = Array.isArray(members) ? members : [];
    return new Map(list.map(member => [normalizeEmail(member.email), member.name]));
  }, [members]);
  const resolveMemberName = (email: string) =>
    memberNameByEmail.get(normalizeEmail(email)) || email;
  const formatLocation = (value?: string) => {
    const trimmed = String(value ?? "").trim();
    return trimmed && trimmed !== "0" ? trimmed : "NA";
  };
  const formatEventTime = (event: ClubEvent) => {
    if (event.hasTime === false) return "NA";
    return event.date.toLocaleString('en-US', { hour: '2-digit', minute:'2-digit' });
  };

  const handleRsvp = (event: ClubEvent) => {
    if (!currentEmail) {
      toast({ title: "Sign in required", description: "Add a user to RSVP.", variant: "destructive" });
      return;
    }
    const normalizedEmail = normalizeEmail(currentEmail);
    setEvents(prev => {
      const list = Array.isArray(prev) ? prev : [];
      return list.map(ev => {
        if (ev.id !== event.id) return ev;
        const rsvps = ev.rsvps || { yes: [], no: [], maybe: [] };
        const filteredYes = (rsvps.yes || []).filter(
          e => normalizeEmail(e) !== normalizedEmail
        );
        const filteredNo = (rsvps.no || []).filter(
          e => normalizeEmail(e) !== normalizedEmail
        );
        const filteredMaybe = (rsvps.maybe || []).filter(
          e => normalizeEmail(e) !== normalizedEmail
        );
        const isCurrentlyRsvped = (rsvps.yes || []).some(
          e => normalizeEmail(e) === normalizedEmail
        );
        const next = {
          yes: isCurrentlyRsvped ? filteredYes : [...filteredYes, normalizedEmail],
          no: filteredNo,
          maybe: filteredMaybe,
        };
        const viewedBy = Array.isArray(ev.viewedBy) ? ev.viewedBy : [];
        const nextViewed = viewedBy.includes(currentEmail) ? viewedBy : [...viewedBy, currentEmail];
        return { ...ev, rsvps: next, viewedBy: nextViewed, read: true };
      });
    });
    const isCurrentlyRsvped = (event.rsvps?.yes || []).some(
      e => normalizeEmail(e) === normalizedEmail
    );
    toast({
      title: isCurrentlyRsvped ? "RSVP removed" : "RSVP recorded",
      description: isCurrentlyRsvped ? "You are no longer RSVP'd." : "Marked as RSVP'd.",
    });
  };


  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    openCalendarAssistant(values.prompt);
    form.reset();
    setShowAi(false);
  };
  
  const handleManualAdd = async (values: z.infer<typeof manualEventSchema>) => {
    const dateTime = parseManualEventDateTime(values.date, values.time);
    const hasTime = Boolean(values.time && values.time.trim());
    const newEvent: ClubEvent = {
      id: createClientEventId(),
      title: values.title,
      description: values.description?.trim() || "",
      date: dateTime,
      location: values.location?.trim() || "",
      hasTime,
      points: values.points || 0,
      rsvpRequired: Boolean(values.rsvpRequired),
      rsvps: { yes: [], no: [], maybe: [] },
      viewedBy: currentEmail ? [currentEmail] : [],
      read: false,
    };
    const persisted = await saveEvents(prevEvents => [...prevEvents, newEvent]);
    if (!persisted) {
      toast({
        title: "Could not add event",
        description: "The event was not saved. Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Event added manually!" });
    manualForm.reset({
      title: "",
      description: "",
      location: "",
      date: "",
      time: "",
      points: 0,
      rsvpRequired: false,
    });
  };
  
  const generateGoogleCalendarLink = (event: ClubEvent) => {
    const formatDate = (date: Date) => {
      return date.toISOString().replace(/-|:|\.\d\d\d/g,"");
    };

    const startTime = formatDate(event.date);
    // Assuming a 1 hour duration for the event
    const endTime = formatDate(new Date(event.date.getTime() + 60 * 60 * 1000));

    const url = new URL("https://www.google.com/calendar/render");
    url.searchParams.append("action", "TEMPLATE");
    url.searchParams.append("text", event.title);
    url.searchParams.append("dates", `${startTime}/${endTime}`);
    url.searchParams.append("details", event.description);
    url.searchParams.append("location", event.location);

    return url.toString();
  };

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const upcomingEvents = useMemo(
    () => [...safeEvents].sort((a, b) => a.date.getTime() - b.date.getTime()),
    [safeEvents]
  );

  const selectedDayEvents = useMemo(() => {
    if (!date) return [];
    return upcomingEvents.filter(event => isSameDay(event.date, date));
  }, [date, upcomingEvents]);

  const weekLabels = ["S", "M", "T", "W", "T", "F", "S"];
  
  return (
    <div className="app-page-shell">
      <div className="app-page-scroll">
    <div className="mx-auto grid w-full max-w-7xl gap-4 md:gap-6 lg:grid-cols-[minmax(22rem,42rem)_minmax(24rem,1fr)] xl:grid-cols-[minmax(24rem,44rem)_minmax(26rem,1fr)]">
      <div className="space-y-4 lg:space-y-6">
        <Card className="mobile-panel overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            {!isClient ? (
              <Skeleton className="w-full aspect-[1.2/1]" />
            ) : (
              <div className="w-full max-w-full space-y-3 overflow-hidden">
                <div className="flex items-center justify-between px-1 sm:px-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-xl"
                    onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
                  >
                    <ChevronLeft className="h-5 w-5" />
                    <span className="sr-only">Previous month</span>
                  </Button>
                  <div className="truncate text-base font-semibold sm:text-lg">
                    {format(currentMonth, "MMMM yyyy")}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-xl"
                    onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
                  >
                    <ChevronRight className="h-5 w-5" />
                    <span className="sr-only">Next month</span>
                  </Button>
                </div>

                <div className="grid w-full max-w-full grid-cols-7 gap-1 sm:gap-1.5">
                  {weekLabels.map(label => (
                    <div key={label} className="flex items-center justify-center py-1 text-[11px] font-medium text-muted-foreground sm:text-xs">
                      {label}
                    </div>
                  ))}

                  {calendarDays.map(day => {
                    const dayEvents = safeEvents.filter(event => isSameDay(event.date, day));
                    const isSelected = date ? isSameDay(day, date) : false;
                    const isCurrentMonth = isSameMonth(day, currentMonth);

                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => setDate(day)}
                        className={cn(
                          "flex aspect-square w-full max-w-full flex-col items-start justify-start gap-1 overflow-hidden rounded-xl border border-transparent p-1.5 text-left transition-colors sm:p-2",
                          isSelected ? "border-primary/40 bg-primary/10" : "bg-background/70",
                          !isCurrentMonth && "opacity-35"
                        )}
                      >
                        <span className="text-xs font-medium sm:text-sm">{format(day, "d")}</span>
                        <div className="mt-auto flex w-full justify-center">
                          {dayEvents.length > 0 ? (
                            <div className="h-1 w-3/5 rounded bg-green-500" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {date ? (
          <Card className="mobile-panel">
            <CardHeader>
              <CardTitle>{format(date, "EEEE, MMMM d")}</CardTitle>
              <CardDescription>Events for the selected day.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents.map(event => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => {
                      markEventViewed(event.id);
                      setSelectedEvent(event);
                    }}
                    className="w-full overflow-hidden rounded-xl border border-border/70 bg-background/70 p-4 text-left"
                  >
                    <div className="space-y-1 break-words">
                      <p className="font-semibold leading-snug">{event.title}</p>
                      <p className="text-sm text-muted-foreground">{formatEventTime(event)}</p>
                      <p className="text-sm text-muted-foreground">{formatLocation(event.location)}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  No events scheduled for this day.
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col space-y-4 lg:space-y-6">
        {canEditContent && (
            <Card className="mobile-panel">
            <CardHeader>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <CardTitle className="flex items-center gap-2"><CalendarDays /> Add Event</CardTitle>
                    <AssistantInlineTrigger
                      onClick={() => {
                        setShowAi(false);
                        openCalendarAssistant("Create an event regarding the following:");
                      }}
                    />
                  </div>
                  <CardDescription>Enter details manually, or let AI draft them.</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                {!showAi && (
                  <Form {...manualForm}>
                    <form onSubmit={manualForm.handleSubmit(handleManualAdd)} className="space-y-4">
                      <FormField
                        control={manualForm.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Title</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={manualForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description (optional)</FormLabel>
                            <FormControl><Textarea className="min-h-[120px]" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={manualForm.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Location (optional)</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.75fr)]">
                        <FormField
                          control={manualForm.control}
                          name="date"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Date</FormLabel>
                              <FormControl><Input type="date" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="time"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Time (optional)</FormLabel>
                              <FormControl><Input type="time" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={manualForm.control}
                          name="points"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Points (optional)</FormLabel>
                              <FormControl><Input type="number" {...field} /></FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={manualForm.control}
                        name="rsvpRequired"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2">
                            <input type="checkbox" checked={field.value || false} onChange={e => field.onChange(e.target.checked)} />
                            <FormLabel className="mt-0">RSVP</FormLabel>
                          </FormItem>
                        )}
                      />
                      <Button type="submit" className="w-full">
                        Add manually
                      </Button>
                    </form>
                  </Form>
                )}

                {showAi && (
                  <div className="pt-4 border-t space-y-3">
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                          <FormField
                          control={form.control}
                          name="prompt"
                          render={({ field }) => (
                              <FormItem>
                              <FormLabel>Assistant prompt</FormLabel>
                              <FormControl>
                                  <Textarea 
                                  placeholder="e.g., Schedule our monthly meeting for next Tuesday at 6 PM in the main auditorium. The topic is planning the summer fundraiser."
                                  className="min-h-[150px]"
                                  {...field} 
                                  />
                              </FormControl>
                              <FormMessage />
                              </FormItem>
                          )}
                          />
                          <Button type="submit" disabled={isLoading} className={`w-full ${aiSparkle}`}>
                          {isLoading ? <Loader2 className="animate-spin" /> : "Continue in Assistant"}
                          </Button>
                      </form>
                    </Form>
                  </div>
                )}
            </CardContent>
            </Card>
        )}
        <Card className="mobile-panel flex flex-1 flex-col">
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>
              Here's what's happening soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
             {loading ? <p>Loading...</p> : 
                error && upcomingEvents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground space-y-3">
                    <div>{error}</div>
                    <Button variant="outline" onClick={() => void refreshData()}>
                      Try again
                    </Button>
                  </div>
                ) :
                upcomingEvents.length > 0 ? (
                  <Accordion type="single" collapsible className="w-full space-y-3">
                    {upcomingEvents.map((event) => (
                      <AccordionItem
                        value={`item-${event.id}`}
                        key={event.id}
                        id={`event-${event.id}`}
                        className={cn(
                          "overflow-hidden rounded-xl border border-border/70 bg-background/70 px-4 scroll-mt-24 transition-shadow",
                          highlightedEventId === event.id &&
                            "ring-2 ring-emerald-500 ring-offset-2 ring-offset-background"
                        )}
                      >
                        <div className="flex w-full items-start justify-between gap-3 py-4">
                            <AccordionTrigger className="min-w-0 flex-grow p-0" onClick={() => markEventViewed(event.id)}>
                                <div className="min-w-0 text-left">
                                <p className="break-words font-semibold leading-snug">{event.title}</p>
                                <p className="text-sm text-muted-foreground font-normal">
                                    {event.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                                </p>
                                </div>
                            </AccordionTrigger>
                            {canEditContent && (
                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEditClick(event);}} className="ml-4 shrink-0">
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                        <AccordionContent>
                          <div className="space-y-3 pb-4">
                             <p className="text-sm">
                                <strong>Time: </strong> 
                                {formatEventTime(event)}
                             </p>
                             <p className="text-sm">{event.description}</p>
                             <p className="text-sm">
                               <strong>Location:</strong> {formatLocation(event.location)}
                             </p>
                              {Number(event.points) > 0 && (
                                <p className="text-sm flex items-center gap-2">
                                  <Award className="h-4 w-4 text-primary" /> <strong>Points:</strong> {event.points}
                                </p>
                              )}

                             {!canEditContent && event.rsvpRequired && (
                               <div className="flex items-center gap-2">
                                 {(() => {
                                   const rsvpYes = event.rsvps?.yes || [];
                                   const isRsvped = currentEmail
                                     ? rsvpYes.map(normalizeEmail).includes(normalizeEmail(currentEmail))
                                     : false;
                                   return (
                                     <Button
                                       size="sm"
                                       variant={isRsvped ? "default" : "outline"}
                                       className={isRsvped ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                                       onClick={() => handleRsvp(event)}
                                     >
                                       {isRsvped ? (
                                         <>
                                           <Check className="mr-2 h-4 w-4" /> RSVP'd
                                         </>
                                       ) : (
                                         "RSVP"
                                       )}
                                     </Button>
                                   );
                                 })()}
                               </div>
                             )}
                             {canEditContent ? (
                               <div className="space-y-2 text-xs text-muted-foreground">
                                 {event.rsvpRequired && (
                                   <details>
                                     <summary className="cursor-pointer">
                                       RSVPs ({(event.rsvps?.yes || []).length})
                                     </summary>
                                     <div className="mt-1 space-y-1">
                                       {(event.rsvps?.yes || []).length > 0
                                         ? (event.rsvps?.yes || []).map(email => (
                                             <div key={email}>{resolveMemberName(email)}</div>
                                           ))
                                         : "No RSVPs yet"}
                                     </div>
                                   </details>
                                 )}
                                 <details>
                                   <summary className="cursor-pointer">
                                     Viewers ({(event.viewedBy || []).length})
                                   </summary>
                                   <div className="mt-1 space-y-1">
                                     {(event.viewedBy || []).length > 0
                                       ? (event.viewedBy || []).map(email => (
                                           <div key={email}>{resolveMemberName(email)}</div>
                                         ))
                                       : "No viewers yet"}
                                   </div>
                                 </details>
                               </div>
                             ) : (
                               (event.rsvps?.yes || []).length > 0 ? (
                                 <p className="text-xs text-muted-foreground">
                                   RSVPs: {(event.rsvps?.yes || []).length}
                                 </p>
                               ) : event.rsvpRequired ? (
                                 <p className="text-xs text-muted-foreground">RSVP required</p>
                               ) : null
                             )}
                             <Link href={generateGoogleCalendarLink(event)} target="_blank" rel="noopener noreferrer">
                               <Button variant="outline" size="sm">
                                 <PlusSquare className="mr-2 h-4 w-4" /> Add to Google Calendar
                               </Button>
                             </Link>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
              ) : (
                 <div className="text-center py-8 text-muted-foreground">No events scheduled.</div>
              )
            }
          </CardContent>
        </Card>
      </div>
    </div>
      </div>
    {selectedEvent && (
        <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{selectedEvent.title}</DialogTitle>
                    <CardDescription>
                         {selectedEvent.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                         {' at '}
                         {formatEventTime(selectedEvent)}
                    </CardDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <p>{selectedEvent.description}</p>
                    <p><strong>Location:</strong> {formatLocation(selectedEvent.location)}</p>
                    {Number(selectedEvent.points) > 0 && (
                      <p className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-primary" /> <strong>Points for attending:</strong> {selectedEvent.points}
                      </p>
                    )}

                    {!canEditContent && selectedEvent.rsvpRequired && (
                      <div className="flex items-center gap-2">
                        {(() => {
                          const rsvpYes = selectedEvent.rsvps?.yes || [];
                          const isRsvped = currentEmail
                            ? rsvpYes.map(normalizeEmail).includes(normalizeEmail(currentEmail))
                            : false;
                          return (
                            <Button
                              size="sm"
                              variant={isRsvped ? "default" : "outline"}
                              className={isRsvped ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                              onClick={() => handleRsvp(selectedEvent)}
                            >
                              {isRsvped ? (
                                <>
                                  <Check className="mr-2 h-4 w-4" /> RSVP'd
                                </>
                              ) : (
                                "RSVP"
                              )}
                            </Button>
                          );
                        })()}
                      </div>
                    )}
                    {canEditContent ? (
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {selectedEvent.rsvpRequired && (
                          <details>
                            <summary className="cursor-pointer">
                              RSVPs ({(selectedEvent.rsvps?.yes || []).length})
                            </summary>
                            <div className="mt-1 space-y-1">
                              {(selectedEvent.rsvps?.yes || []).length > 0
                                ? (selectedEvent.rsvps?.yes || []).map(email => (
                                    <div key={email}>{resolveMemberName(email)}</div>
                                  ))
                                : "No RSVPs yet"}
                            </div>
                          </details>
                        )}
                        <details>
                          <summary className="cursor-pointer">
                            Viewers ({(selectedEvent.viewedBy || []).length})
                          </summary>
                          <div className="mt-1 space-y-1">
                            {(selectedEvent.viewedBy || []).length > 0
                              ? (selectedEvent.viewedBy || []).map(email => (
                                  <div key={email}>{resolveMemberName(email)}</div>
                                ))
                              : "No viewers yet"}
                          </div>
                        </details>
                      </div>
                    ) : (
                      (selectedEvent.rsvps?.yes || []).length > 0 ? (
                        <p className="text-sm text-muted-foreground">
                          RSVPs: {(selectedEvent.rsvps?.yes || []).length}
                        </p>
                      ) : selectedEvent.rsvpRequired ? (
                        <p className="text-sm text-muted-foreground">RSVP required</p>
                      ) : null
                    )}
                </div>
                <DialogFooter className="flex-row flex-wrap justify-between gap-2 sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={generateGoogleCalendarLink(selectedEvent)} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline">
                              <PlusSquare className="mr-2 h-4 w-4" /> Add to Google Calendar
                          </Button>
                      </Link>
                      {canEditContent && (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => setDeleteCandidateEvent(selectedEvent)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete Event
                        </Button>
                      )}
                    </div>
                    {canEditContent && (
                        <Button onClick={() => handleEditClick(selectedEvent)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit Event
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )}
    <AlertDialog
      open={Boolean(deleteCandidateEvent)}
      onOpenChange={(open) => {
        if (!deletingEvent && !open) {
          setDeleteCandidateEvent(null);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete event?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove {deleteCandidateEvent?.title || "this event"} from the calendar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletingEvent}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deletingEvent}
            onClick={(event) => {
              event.preventDefault();
              void handleDeleteEvent();
            }}
          >
            {deletingEvent ? "Deleting..." : "Delete event"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {editingEvent && (
        <Dialog
          open={!!editingEvent}
          onOpenChange={() => {
            if (savingEvent) return;
            setEditingDraftEvent(false);
            setEditingEvent(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingDraftEvent ? "Review Event" : "Edit Event"}</DialogTitle>
            </DialogHeader>
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleUpdateEvent)} className="space-y-4">
                 <FormField
                  control={editForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={editForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl><Textarea {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={editForm.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location (optional)</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={editForm.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date and Time</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {canEditContent && (
                  <FormField
                    control={editForm.control}
                    name="points"
                    render={({ field }) => (
                      <FormItem>
                        <Label>Points for Attendance</Label>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={editForm.control}
                  name="rsvpRequired"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={field.value || false}
                        onChange={e => field.onChange(e.target.checked)}
                      />
                      <FormLabel className="mt-0">RSVP</FormLabel>
                    </FormItem>
                  )}
                />
                <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={savingEvent}
                      onClick={() => {
                        if (savingEvent) return;
                        setEditingDraftEvent(false);
                        setEditingEvent(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={savingEvent}>
                      {savingEvent ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : editingDraftEvent ? "Add Event" : "Save Changes"}
                    </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
    )}
    </div>
  );
}

    
