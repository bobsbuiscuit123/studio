
"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Landmark,
  UsersRound,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useMembers, useEvents, useMessages, useCurrentUser } from "@/lib/data-hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: members, loading: membersLoading, clubId } = useMembers();
  const { data: events, loading: eventsLoading } = useEvents();
  const { user, loading: userLoading } = useCurrentUser();
  const { allMessages, loading: messagesLoading } = useMessages(user?.email);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!clubId && !membersLoading) {
      router.push('/');
    }
  }, [clubId, membersLoading, router]);

  useEffect(() => {
    if (!messagesLoading && user && allMessages) {
      const unreadMessages = allMessages.filter(m => m.recipientEmail === user.email && !m.read);
      if (unreadMessages.length > 0) {
        toast({
          title: "You have new messages!",
          description: `You have ${unreadMessages.length} unread message(s).`,
        });
      }
    }
  }, [messagesLoading, user, allMessages, toast]);

  if (membersLoading || eventsLoading || !clubId || userLoading) {
    return (
       <div className="flex flex-col gap-4 md:gap-8">
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card><CardHeader><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-12" /><Skeleton className="h-3 w-32 mt-1" /></CardContent></Card>
        <Card><CardHeader><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-32" /><Skeleton className="h-3 w-20 mt-1" /></CardContent></Card>
        <Card><CardHeader><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-32 mt-1" /></CardContent></Card>
        <Card><CardHeader><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-32 mt-1" /></CardContent></Card>
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>New Members</CardTitle><CardDescription>Recently joined members.</CardDescription></CardHeader>
          <CardContent><Skeleton className="h-48 w-full" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Upcoming Events</CardTitle><CardDescription>Don't miss these events.</CardDescription></CardHeader>
          <CardContent className="grid gap-8"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></CardContent>
        </Card>
      </div>
    </div>
    );
  }
  
  const upcomingEvent = events.length > 0 ? [...events].sort((a,b) => a.date.getTime() - b.date.getTime())[0] : null;

  return (
    <div className="flex flex-col gap-4 md:gap-8">
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <UsersRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members.length}</div>
            <p className="text-xs text-muted-foreground">The heart of your club.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Upcoming Event
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
             {upcomingEvent ? (
              <>
                <div className="text-2xl font-bold truncate">{upcomingEvent.title}</div>
                <p className="text-xs text-muted-foreground">
                  {upcomingEvent.date.toLocaleDateString()}
                </p>
              </>
            ) : (
              <div className="text-xl font-semibold text-muted-foreground">No upcoming events</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Treasury</CardTitle>
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$0.00</div>
            <p className="text-xs text-muted-foreground">
              Connect to a payment provider.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Stay Updated</div>
            <p className="text-xs text-muted-foreground">
              Activity from all club channels.
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:gap-8 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
              <CardTitle>New Members</CardTitle>
              <CardDescription>
                Recently joined members of the club.
              </CardDescription>
            </div>
            <Button asChild size="sm" className="ml-auto gap-1">
              <Link href="/members">
                View All
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
             {members.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.slice(0, 5).map((member) => (
                  <TableRow key={member.email}>
                    <TableCell>
                      <div className="font-medium">{member.name}</div>
                      <div className="hidden text-sm text-muted-foreground md:inline">
                        {member.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{member.role}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            ) : (
               <div className="text-center py-8 text-muted-foreground">No members yet.</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>
              Don't miss out on these upcoming events.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-8">
            {events.slice(0, 3).map((event, index) => (
              <div key={index} className="flex items-center gap-4">
                <CalendarDays className="h-8 w-8 text-muted-foreground" />
                <div className="grid gap-1">
                  <p className="text-sm font-medium leading-none">
                    {event.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {event.date.toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
             {events.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">No events scheduled.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
