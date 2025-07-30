
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
import { CalendarDays, Loader2, Pencil, PlusSquare } from "lucide-react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Input } from "@/components/ui/input";
import Link from "next/link";

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
  const [selectedEvent, setSelectedEvent] = useState<ClubEvent | null>(null);
  const { canEditContent } = useCurrentUserRole();
  
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
    setSelectedEvent(null); // Close the details dialog if open
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
      event.id === editingEvent.id ? { ...event, title: values.title, description: values.description, location: values.location, date: new Date(values.date) } : event
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
                        <div
                            key={i} 
                            className="cursor-pointer text-xs bg-primary/20 text-primary-foreground rounded-sm px-1 w-full truncate text-left hover:bg-primary/40"
                            onClick={() => setSelectedEvent(event)}
                        >
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
        {canEditContent && (
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
          <CardContent>
             {loading ? <p>Loading...</p> : 
                events.length > 0 ? (
                  <Accordion type="single" collapsible className="w-full">
                    {[...events].sort((a,b) => a.date.getTime() - b.date.getTime()).map((event) => (
                      <AccordionItem value={`item-${event.id}`} key={event.id}>
                        <div className="flex justify-between items-center w-full py-4">
                            <AccordionTrigger className="flex-grow p-0">
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
                                {event.date.toLocaleString('en-US', { hour: '2-digit', minute:'2-digit' })}
                             </p>
                             <p className="text-sm">{event.description}</p>
                             <p className="text-sm">
                               <strong>Location:</strong> {event.location}
                             </p>
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
    {/* Event Details Dialog */}
    {selectedEvent && (
        <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{selectedEvent.title}</DialogTitle>
                    <CardDescription>
                         {selectedEvent.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                         {' at '}
                         {selectedEvent.date.toLocaleString('en-US', { hour: '2-digit', minute:'2-digit' })}
                    </CardDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <p>{selectedEvent.description}</p>
                    <p><strong>Location:</strong> {selectedEvent.location}</p>
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
    {/* Edit Event Dialog */}
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
