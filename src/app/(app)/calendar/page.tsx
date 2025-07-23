"use client";

import { useState, useEffect } from "react";
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
import { CalendarDays, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { addCalendarEvent, AddCalendarEventOutput } from "@/ai/flows/add-calendar-event";
import { useToast } from "@/hooks/use-toast";
import { useEvents, useCurrentUserRole } from "@/lib/data-hooks";
import type { ClubEvent } from "@/lib/mock-data";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
  prompt: z.string().min(10, "Please provide a more detailed prompt."),
});

const editFormSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters."),
    description: z.string().min(10, "Description must be at least 10 characters."),
    location: z.string().min(2, "Location must be at least 2 characters."),
    date: z.string(),
});

export default function CalendarPage() {
  const [date, setDate] = useState<Date | undefined>();
  const { data: events, updateData: setEvents, loading } = useEvents();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const { role } = useCurrentUserRole();
  
  useEffect(() => {
    setDate(new Date());
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
    },
  });
  
  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
  });

  const handleEditClick = (event: ClubEvent) => {
    setEditingEvent(event);
    editForm.reset({
      title: event.title,
      description: event.description,
      location: event.location,
      date: event.date.toISOString().slice(0, 16), // Format for datetime-local input
    });
  };

  const handleUpdateEvent = (values: z.infer<typeof editFormSchema>) => {
    if (!editingEvent) return;
    const updatedEvents = events.map((event) =>
      event.id === editingEvent.id ? { ...event, ...values, date: new Date(values.date) } : event
    );
    setEvents(updatedEvents);
    toast({ title: "Event updated!" });
    setEditingEvent(null);
  };


  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result: AddCalendarEventOutput = await addCalendarEvent(values);
      const newEvent: ClubEvent = {
        id: (events.length + 1).toString(),
        title: result.title,
        description: result.description,
        date: new Date(result.date),
        location: result.location,
      };
      setEvents([...events, newEvent]);
      toast({ title: "Event added successfully!" });
      form.reset();
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to add event from prompt.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const isOwner = role && role !== 'Member';

  return (
    <>
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-2">
        <Card>
          <CardContent className="p-0">
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
                  const dayEvents = events.filter(
                    (event) =>
                      event.date.getDate() === date.getDate() &&
                      event.date.getMonth() === date.getMonth() &&
                      event.date.getFullYear() === date.getFullYear()
                  );
                  return (
                    <div className="flex flex-col h-full items-start justify-start">
                      <p>{date.getDate()}</p>
                      {dayEvents.map((event, i) => (
                        <div key={i} className="text-xs bg-primary/20 text-primary-foreground rounded-sm px-1 w-full truncate">
                          {event.title}
                        </div>
                      ))}
                    </div>
                  );
                },
              }}
            />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        {isOwner && (
            <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><CalendarDays /> Add Event</CardTitle>
                <CardDescription>Describe the event you want to add to the calendar.</CardDescription>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                    <FormField
                    control={form.control}
                    name="prompt"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Prompt</FormLabel>
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
                    <Button type="submit" disabled={isLoading} className="w-full">
                    {isLoading ? <Loader2 className="animate-spin" /> : "Add Event with AI"}
                    </Button>
                </form>
                </Form>
            </CardContent>
            </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>
              Here's what's happening soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             {loading ? <p>Loading...</p> : 
                events.length > 0 ? (
                  [...events].sort((a,b) => a.date.getTime() - b.date.getTime()).map((event, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="font-semibold">{event.title}</p>
                            <p className="text-sm text-muted-foreground">
                            {event.date.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}
                            </p>
                        </div>
                        {isOwner && (
                            <Button variant="ghost" size="icon" onClick={() => handleEditClick(event)}>
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    <p className="text-sm mt-2">{event.description}</p>
                    <p className="text-sm mt-1">
                      <strong>Location:</strong> {event.location}
                    </p>
                  </div>
                ))
              ) : (
                 <div className="text-center py-8 text-muted-foreground">No events scheduled.</div>
              )
            }
          </CardContent>
        </Card>
      </div>
    </div>
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
                      <FormLabel>Location</FormLabel>
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
