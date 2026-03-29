

"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { faker } from "@faker-js/faker";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useEvents, useCurrentUserRole, useCurrentUser, useMembers } from "@/lib/data-hooks";
import type { ClubEvent, Member } from "@/lib/mock-data";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle, KeyRound, Loader2, Users } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const checkInFormSchema = z.object({
  code: z.string().length(4, "Code must be 4 characters.").regex(/^[A-Z0-9]{4}$/, "Invalid code format."),
});

export default function AttendancePage() {
  const { data: events, updateDataAsync: saveEvents, loading: eventsLoading } = useEvents();
  const { data: members, loading: membersLoading } = useMembers();
  const { user, loading: userLoading } = useCurrentUser();
  const { canEditContent } = useCurrentUserRole();
  const { toast } = useToast();
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  const form = useForm<z.infer<typeof checkInFormSchema>>({
    resolver: zodResolver(checkInFormSchema),
    defaultValues: { code: "" },
  });

  const handleGenerateCode = async (eventId: string) => {
    const code = faker.string.alphanumeric(4).toUpperCase();
    const saved = await saveEvents(prevEvents =>
      prevEvents.map(event =>
        event.id === eventId ? { ...event, checkInCode: code } : event
      )
    );
    if (!saved) {
      toast({
        title: "Could not generate code",
        description: "The check-in code was not saved. Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Check-in code generated!", description: `The code for the event is ${code}.` });
  };

  const handleCheckIn = async (eventId: string, values: z.infer<typeof checkInFormSchema>) => {
    if (!user) return;
    const event = events.find(e => e.id === eventId);
    if (!event || !event.checkInCode) {
      toast({ title: "Error", description: "This event does not have a check-in code.", variant: "destructive" });
      return;
    }

    if (event.checkInCode.toUpperCase() !== values.code.toUpperCase()) {
      toast({ title: "Invalid Code", description: "The check-in code is incorrect.", variant: "destructive" });
      return;
    }

    const attendees = event.attendees || [];
    if (attendees.includes(user.email)) {
      toast({ title: "Already Checked In", description: "You have already been marked as attended for this event." });
      return;
    }
    
    // Note: Point allocation logic happens implicitly via useEffect on the Points page
    // when the 'events' data changes.

    const saved = await saveEvents(prevEvents =>
      prevEvents.map(e =>
        e.id === eventId ? { ...e, attendees: [...attendees, user.email] } : e
      )
    );
    if (!saved) {
      toast({
        title: "Check-in failed",
        description: "Your attendance was not saved. Please try again.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Check-in Successful!", description: `You have been marked as attended for "${event.title}".` });
    form.reset();
  };

  const sortedEvents = [...events].sort((a, b) => b.date.getTime() - a.date.getTime());
  const now = new Date();

  const upcomingEvents = sortedEvents.filter(e => e.date >= now);
  const pastEvents = sortedEvents.filter(e => e.date < now);
  
  const userAttendance = sortedEvents.filter(e => e.attendees?.includes(user?.email || ''));


  if (eventsLoading || userLoading || membersLoading) {
    return (
      <div className="app-page-shell">
        <div className="app-page-scroll">
          <div className="flex min-h-0 flex-1 flex-col justify-start">
            <Loader2 className="animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (canEditContent) {
    // Admin/officer view
    return (
      <div className="app-page-shell">
        <div className="app-page-scroll">
      <div className="flex min-h-0 flex-1 flex-col gap-3 justify-start">
        <div className="shrink-0">
          <h1 className="text-3xl font-bold">Event Attendance</h1>
          <p className="text-muted-foreground">Manage check-in codes and view attendance records for club events.</p>
        </div>
        <div className="min-h-0 flex-1">
        <Card>
          <CardHeader>
            <CardTitle>All Events</CardTitle>
            <CardDescription>Generate codes and view who attended each event.</CardDescription>
          </CardHeader>
          <CardContent>
            {sortedEvents.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No events found.</p>
            ) : (
                <Accordion type="single" collapsible className="w-full">
                    {sortedEvents.map(event => {
                        const attendeesList: Member[] = (event.attendees || [])
                            .map(email => members.find(m => m.email === email))
                            .filter((m): m is Member => !!m);

                        return (
                        <AccordionItem value={event.id} key={event.id}>
                            <AccordionTrigger>
                                <div className="flex justify-between items-center w-full">
                                    <div>
                                        <p className="font-semibold">{event.title}</p>
                                        <p className="text-sm text-muted-foreground font-normal">
                                            {event.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                                        </p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between p-4 bg-muted/50 rounded-lg">
                                    <div>
                                        <p className="font-semibold text-sm mb-1">Check-in Code</p>
                                        {event.checkInCode ? (
                                            <p className="font-mono text-2xl tracking-widest bg-background p-2 rounded-md inline-block">{event.checkInCode}</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">No code generated.</p>
                                        )}
                                    </div>
                                    <Button onClick={() => handleGenerateCode(event.id)}><KeyRound className="mr-2"/> Generate New Code</Button>
                                </div>
                                <div>
                                    <h4 className="font-semibold flex items-center gap-2 mb-2"><Users/> Attendees ({attendeesList.length})</h4>
                                    {attendeesList.length > 0 ? (
                                        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                                            {attendeesList.map(attendee => (
                                                <li key={attendee.email}>{attendee.name}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">No one has checked in for this event yet.</p>
                                    )}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    )})}
                </Accordion>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
        </div>
      </div>
    );
  }

  // Member View
  return (
    <div className="app-page-shell">
      <div className="app-page-scroll">
    <div className="flex min-h-0 flex-1 flex-col gap-3 justify-start">
        <div className="shrink-0 space-y-1">
            <h1 className="text-2xl font-semibold">Attendance</h1>
            <p className="text-sm text-muted-foreground">Check in to events and review the attendance you have logged.</p>
        </div>
        <div className="min-h-0 flex-1">
    <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Event Check-in</CardTitle>
                    <CardDescription>Enter the code provided at the event to mark your attendance.</CardDescription>
                </CardHeader>
                <CardContent>
                {upcomingEvents.length === 0 ? (
                     <p className="text-muted-foreground text-center py-8">No upcoming events available for check-in.</p>
                ) : (
                    <Accordion type="single" collapsible onValueChange={setActiveEventId}>
                        {upcomingEvents.map(event => (
                            <AccordionItem value={event.id} key={event.id}>
                                <AccordionTrigger>
                                     <div>
                                        <p className="font-semibold">{event.title}</p>
                                        <p className="text-sm text-muted-foreground font-normal">
                                            {event.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                                        </p>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <form onSubmit={form.handleSubmit(data => handleCheckIn(event.id, data))} className="flex items-center gap-2 p-2">
                                        <Input {...form.register('code')} placeholder="A1B2" maxLength={4} className="uppercase font-mono tracking-widest"/>
                                        <Button type="submit">Check In</Button>
                                    </form>
                                     {form.formState.errors.code && <p className="text-destructive text-sm mt-1 px-2">{form.formState.errors.code.message}</p>}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                )}
                </CardContent>
            </Card>
        </div>
        <div className="md:col-span-1">
            <Card>
                <CardHeader>
                    <CardTitle>My Attendance History</CardTitle>
                    <CardDescription>A record of the events you've attended.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {userAttendance.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">You have not attended any events yet.</p>
                    ) : (
                        userAttendance.map(event => (
                            <div key={`history-${event.id}`} className="flex items-center gap-4">
                                <CheckCircle className="text-green-500"/>
                                <div>
                                    <p className="font-semibold">{event.title}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {event.date.toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    </div>
    </div>
    </div>
      </div>
    </div>
  );
}
