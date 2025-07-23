"use client";

import { useState } from "react";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { announcements as initialAnnouncements } from "@/lib/mock-data";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Announcement = (typeof initialAnnouncements)[0];

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);

  return (
    <div className="flex flex-col gap-4">
       <Alert>
        <Megaphone className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          To create a new announcement, please use the <Link href="/assistant" className="font-semibold underline">AI Assistant</Link>.
        </AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {announcements.map((announcement) => (
          <Card key={announcement.id}>
            <CardHeader>
              <CardTitle>{announcement.title}</CardTitle>
              <CardDescription>
                Posted by {announcement.author} - {announcement.date}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {announcement.content}
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="link" className="p-0">
                Read More
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
