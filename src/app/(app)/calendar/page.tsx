"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { events as initialEvents } from "@/lib/mock-data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CalendarDays } from "lucide-react";
import Link from "next/link";

export default function CalendarPage() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [events] = useState(initialEvents);

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <CalendarDays className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          To add a new event to the calendar, please use the <Link href="/assistant" className="font-semibold underline">AI Assistant</Link>.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 md:gap-8">
        <div className="lg:col-span-2">
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
        <div>
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
    </div>
  );
}
