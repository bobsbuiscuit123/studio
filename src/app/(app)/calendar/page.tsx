
"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, Loader2, Pencil, PlusSquare, Award, Sparkles, Check } from "lucide-react";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFetchJson } from "@/lib/network";

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
const manualEventSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters."),
  description: z.string().optional().or(z.literal("")),
  location: z.string().optional().or(z.literal("")),
  date: z.string(),
  time: z.string().optional().or(z.literal("")),
  points: z.coerce.number().min(0).optional(),
  rsvpRequired: z.boolean().optional(),
});

export default function CalendarPage() {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [isClient, setIsClient] = useState(false);
  const { data: events, updateData: setEvents, loading } = useEvents();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ClubEvent | null>(null);
  const { canEditContent } = useCurrentUserRole();
  const { user } = useCurrentUser();
  const { data: members } = useMembers();
  const currentEmail = user?.email || "";
  const safeEvents = Array.isArray(events) ? events : [];
  const [showAi, setShowAi] = useState(false);
  const aiSparkle = "bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.35)]";

  useEffect(() => {
    setIsClient(true);
    setDate(new Date());
  }, []);

  useEffect(() => {
    if (!selectedEvent) return;
    const updated = safeEvents.find(event => event.id === selectedEvent.id);
    if (updated && updated !== selectedEvent) {
      setSelectedEvent(updated);
    }
  }, [safeEvents, selectedEvent]);

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

  const handleEditClick = (event: ClubEvent) => {
    setEditingEvent(event);
    setSelectedEvent(null); // Close the details dialog if open
    editForm.reset({
      title: event.title,
      description: event.description,
      location: event.location,
      date: event.date.toISOString().slice(0, 16), // Format for datetime-local input
      points: event.points || 0,
      rsvpRequired: Boolean(event.rsvpRequired),
    });
  };

  const handleUpdateEvent = (values: z.infer<typeof editFormSchema>) => {
    if (!editingEvent) return;
    const updatedEvents = safeEvents.map((event) =>
      event.id === editingEvent.id
        ? {
            ...event,
            title: values.title,
            description: values.description,
            location: values.location?.trim() || "",
            date: new Date(values.date),
            hasTime: true,
            points: values.points,
            rsvpRequired: Boolean(values.rsvpRequired),
          }
        : event
    );
    setEvents(updatedEvents);
    toast({ title: "Event updated!" });
    setEditingEvent(null);
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

  const handleRsvp = (event: ClubEvent, status: 'yes') => {
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
        const next = {
          yes: status === 'yes' ? [...filteredYes, normalizedEmail] : filteredYes,
          no: filteredNo,
          maybe: filteredMaybe,
        };
        const viewedBy = Array.isArray(ev.viewedBy) ? ev.viewedBy : [];
        const nextViewed = viewedBy.includes(currentEmail) ? viewedBy : [...viewedBy, currentEmail];
        return { ...ev, rsvps: next, viewedBy: nextViewed, read: true };
      });
    });
    toast({ title: "RSVP recorded", description: "Marked as RSVP'd." });
  };


  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await safeFetchJson<CalendarAiResponse>('/api/calendar/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: values.prompt }),
        timeoutMs: 15_000,
        retry: { retries: 1 },
        idempotencyKey,
      });
      if (!response.ok) {
        throw new Error(response.error.message || 'Failed to generate event.');
      }
      if (!response.data.ok) {
        throw new Error(response.data.error.message || 'Failed to generate event.');
      }
      const result = response.data.data;
      const hasTime =
        typeof result?.hasTime === 'boolean' ? result.hasTime : true;
      const parsedDate = new Date(result.date);
      const safeDate = Number.isNaN(parsedDate.getTime())
        ? new Date()
        : parsedDate;
      const newEvent: ClubEvent = {
        id: (safeEvents.length + 1).toString(),
        title: result.title,
        description: result.description,
        date: safeDate,
        location: result.location ?? "",
        hasTime,
        points: 0, // Default points, can be edited
        rsvps: { yes: [], no: [], maybe: [] },
        rsvpRequired: false,
        viewedBy: currentEmail ? [currentEmail] : [],
        read: false,
      };
      // Pass a function to setEvents to ensure we're updating the latest state
      setEvents(prevEvents => [...prevEvents, newEvent]);
      toast({ title: "Event added successfully!" });
      form.reset();
      handleEditClick(newEvent); // Open edit dialog to set points
    } catch (error: any) {
      console.error(error);
      toast({
        title: "Error adding event with AI",
        description: error?.message ?? "There was a problem generating the event from your prompt. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleManualAdd = (values: z.infer<typeof manualEventSchema>) => {
    const dateTime = values.time
      ? new Date(`${values.date}T${values.time}`)
      : new Date(`${values.date}T00:00`);
    const hasTime = Boolean(values.time && values.time.trim());
    const newEvent: ClubEvent = {
      id: (safeEvents.length + 1).toString(),
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
    setEvents(prevEvents => [...prevEvents, newEvent]);
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
  
  return (
    <>
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-2">
        <Card>
          <CardContent className="p-0">
            {!isClient ? (
              <Skeleton className="w-full aspect-[1.2/1]" />
            ) : (
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              className="p-0"
              classNames={{
                months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                month: "space-y-4 w-full",
                table: "w-full border-collapse space-y-1",
                head_cell: "w-full text-muted-foreground rounded-md font-normal text-[0.8rem]",
                row: "flex w-full mt-2",
                cell: "h-16 w-full text-center text-sm p-1 relative [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
                day: "h-full w-full p-1 font-normal aria-selected:opacity-100",
              }}
              components={{
                DayContent: ({ date }) => {
                  if (loading) return <div>...</div>
                  const dayEvents = safeEvents.filter(
                    (event) =>
                      event.date.getDate() === date.getDate() &&
                      event.date.getMonth() === date.getMonth() &&
                      event.date.getFullYear() === date.getFullYear()
                  );
                  return (
                    <div className="flex flex-col h-full items-start justify-start">
                      <p>{date.getDate()}</p>
                      {dayEvents.map((event, i) => (
                        <div
                            key={i} 
                            className="cursor-pointer text-xs bg-primary/20 text-primary-foreground rounded-sm px-1 w-full truncate text-left hover:bg-primary/40"
                            onClick={() => { markEventViewed(event.id); setSelectedEvent(event); }}
                        >
                          {event.title}
                        </div>
                      ))}
                    </div>
                  );
                },
              }}
            />
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4 flex flex-col">
        {canEditContent && (
            <Card>
            <CardHeader className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><CalendarDays /> Add Event</CardTitle>
                  <CardDescription>Enter details manually, or let AI draft them.</CardDescription>
                </div>
                <Button
                  type="button"
                  variant={showAi ? "default" : "ghost"}
                  className={showAi ? '' : aiSparkle}
                  onClick={() => setShowAi(v => !v)}
                >
                  {showAi ? 'Make manually' : <><Sparkles className="h-4 w-4 mr-1" /> Make with AI</>}
                </Button>
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
                              <FormLabel>AI prompt</FormLabel>
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
                          {isLoading ? <Loader2 className="animate-spin" /> : "Add with AI"}
                          </Button>
                      </form>
                    </Form>
                  </div>
                )}
            </CardContent>
            </Card>
        )}
        <Card className="flex-1 flex flex-col">
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>
              Here's what's happening soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
             <ScrollArea className="h-full">
             {loading ? <p>Loading...</p> : 
                safeEvents.length > 0 ? (
                  <Accordion type="single" collapsible className="w-full">
                    {[...safeEvents].sort((a,b) => a.date.getTime() - b.date.getTime()).map((event) => (
                      <AccordionItem value={`item-${event.id}`} key={event.id}>
                        <div className="flex justify-between items-center w-full py-4">
                            <AccordionTrigger className="flex-grow p-0" onClick={() => markEventViewed(event.id)}>
                                <div className="text-left">
                                <p className="font-semibold">{event.title}</p>
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
                          <div className="space-y-3 pl-2">
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
                                       onClick={() => handleRsvp(event, 'yes')}
                                       disabled={isRsvped}
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
            </ScrollArea>
          </CardContent>
        </Card>
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
                              onClick={() => handleRsvp(selectedEvent, 'yes')}
                              disabled={isRsvped}
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
                <DialogFooter className="sm:justify-between gap-2">
                    <Link href={generateGoogleCalendarLink(selectedEvent)} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline">
                            <PlusSquare className="mr-2 h-4 w-4" /> Add to Google Calendar
                        </Button>
                    </Link>
                    {canEditContent && (
                        <Button onClick={() => handleEditClick(selectedEvent)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit Event
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )}
    {editingEvent && (
        <Dialog open={!!editingEvent} onOpenChange={() => setEditingEvent(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Event</DialogTitle>
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
                    <Button type="button" variant="ghost" onClick={() => setEditingEvent(null)}>Cancel</Button>
                    <Button type="submit">Save Changes</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
    )}
    </>
  );
}

    
