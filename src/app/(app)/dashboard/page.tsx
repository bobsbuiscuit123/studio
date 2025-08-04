
"use client";

import Link from "next/link";
import React from "react";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Landmark,
  UsersRound,
  Megaphone,
  Network,
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
import { useMembers, useEvents, useAnnouncements, useSocialPosts, useTransactions } from "@/lib/data-hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

export default function Dashboard() {
  const { data: members, loading: membersLoading, clubId } = useMembers();
  const { data: events, loading: eventsLoading } = useEvents();
  const { data: announcements, loading: announcementsLoading } = useAnnouncements();
  const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
  const { data: transactions, loading: transactionsLoading } = useTransactions();
  const router = useRouter();

  useEffect(() => {
    if (!clubId && !membersLoading) {
      router.push('/');
    }
  }, [clubId, membersLoading, router]);
  
  const mostRecentActivity = useMemo(() => {
    if (announcementsLoading || socialPostsLoading || eventsLoading) return null;

    const allActivities = [
        ...announcements.map(a => ({...a, type: 'announcement', date: new Date(a.date), link: '/announcements' })),
        ...socialPosts.map(p => ({...p, type: 'social', date: new Date(p.date), link: '/social' })),
        ...events.map(e => ({...e, type: 'event', date: e.date, link: '/calendar' }))
    ];

    if (allActivities.length === 0) return null;

    return allActivities.sort((a, b) => b.date.getTime() - a.date.getTime())[0];

  }, [announcements, socialPosts, events, announcementsLoading, socialPostsLoading, eventsLoading]);

  const activityIcon = useMemo(() => {
    if (!mostRecentActivity) return Activity;
    switch (mostRecentActivity.type) {
      case 'announcement': return Megaphone;
      case 'social': return Network;
      case 'event': return CalendarDays;
      default: return Activity;
    }
  }, [mostRecentActivity]);

  const netBalance = useMemo(() => {
    if (transactionsLoading || !transactions) return 0;
    return transactions.reduce((acc, t) => acc + t.amount, 0);
  }, [transactions, transactionsLoading]);


  if (membersLoading || eventsLoading || !clubId || announcementsLoading || socialPostsLoading || transactionsLoading) {
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
            <div className="text-2xl font-bold">${netBalance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Current net balance of all transactions.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
            {React.createElement(activityIcon, { className: "h-4 w-4 text-muted-foreground" })}
          </CardHeader>
          <CardContent>
            {mostRecentActivity ? (
                 <Link href={mostRecentActivity.link}>
                    <div className="text-2xl font-bold hover:underline truncate" title={mostRecentActivity.title}>
                        {mostRecentActivity.title}
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">
                        {mostRecentActivity.type} from {mostRecentActivity.date.toLocaleDateString()}
                    </p>
                </Link>
            ) : (
                <>
                 <div className="text-2xl font-bold">No Activity</div>
                    <p className="text-xs text-muted-foreground">
                    No recent club activity.
                    </p>
                </>
            )}
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
