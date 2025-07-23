"use client";

import { useState } from "react";
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
import { events as initialEvents } from "@/lib/mock-data";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { addCalendarEvent, AddCalendarEventOutput } from "@/ai/flows/add-calendar-event";
import { useToast } from "@/hooks/use-toast";

type ClubEvent = (typeof initialEvents)[0];

const formSchema = z.object({
  title: z.string().min(1, "Title is required."),
  description: z.string().min(1, "Description is required."),
  date: z.string().min(1, "Date is required."),
  location: z.string().min(1, "Location is required."),
});

export default function CalendarPage() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [events, setEvents] = useState<ClubEvent[]>(initialEvents);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      date: "",
      location: "",
    },
  });

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      const result: AddCalendarEventOutput = await addCalendarEvent(values);
      const newEvent: ClubEvent = {
        title: result.event.title,
        description: result.event.description,
        date: new Date(result.event.date),
        location: result.event.location,
      };
      setEvents([newEvent, ...events]);
      toast({ title: "Event added successfully!" });
      form.reset();
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to add event.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarDays /> Add Event</CardTitle>
            <CardDescription>Use AI to add a new event to the calendar.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Event Title</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Monthly Meeting" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="What is the event about?" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date & Time</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Next Friday at 3pm" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Room 101" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? <Loader2 className="animate-spin" /> : "Add Event"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>
              Here's what's happening soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {events.map((event, index) => (
              <div key={index} className="p-4 rounded-lg bg-muted/50">
                <p className="font-semibold">{event.title}</p>
                <p className="text-sm text-muted-foreground">
                  {event.date.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' })}
                </p>
                <p className="text-sm mt-2">{event.description}</p>
                <p className="text-sm mt-1">
                  <strong>Location:</strong> {event.location}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
