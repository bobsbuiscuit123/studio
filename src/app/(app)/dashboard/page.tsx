
"use client";

import Link from "next/link";
import React from "react";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Megaphone,
  Network,
  Sparkles,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  useMembers,
  useEvents,
  useAnnouncements,
  useGalleryImages,
  useMessages,
  useGroupChats,
  useTransactions,
  usePointEntries,
  useForms,
  useSocialPosts,
  useCurrentUser,
  useCurrentUserRole,
} from "@/lib/data-hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useMemo } from "react";
import AIInsights from "@/components/officer/ai-insights";
import { useGroupUserStateSection } from "@/lib/group-user-state";
import { getUtcDayKey } from "@/lib/day-key";

type ActivityItem = {
  type: string;
  title: string;
  date: Date;
  link: string;
  actor: string | null;
};

type MissedActivitySnapshot = {
  members: string[];
  events: string[];
  rsvps: Record<string, { yes: string[]; no: string[]; maybe: string[] }>;
  attendees: Record<string, string[]>;
};

type MissedActivityCache = {
  contextVersion: string;
  title: string;
  bullets: string[];
  actions: { label: string; href: string }[];
};

type DashboardStoredState = {
  missedLastSeenAt: number;
  missedLastShownDay: string | null;
  shownMissedActivityKeys: string[];
  missedSnapshot: MissedActivitySnapshot;
  missedSummaryCache: MissedActivityCache | null;
};

const DEFAULT_DASHBOARD_STATE: DashboardStoredState = {
  missedLastSeenAt: 0,
  missedLastShownDay: null,
  shownMissedActivityKeys: [],
  missedSnapshot: {
    members: [],
    events: [],
    rsvps: {},
    attendees: {},
  },
  missedSummaryCache: null,
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const typewriterText = ({
  text,
  startAt,
  now,
  charDelayMs = 18,
}: {
  text: string;
  startAt: number;
  now: number;
  charDelayMs?: number;
}) => {
  if (!startAt) return text;
  const elapsed = Math.max(0, now - startAt);
  const visibleCount = Math.min(text.length, Math.floor(elapsed / charDelayMs) + 1);
  return text.slice(0, visibleCount);
};

const normalizeEmail = (email?: string | null) => (email ?? "").toLowerCase();
const createActivityKey = (item: Pick<ActivityItem, "type" | "title" | "link" | "actor">) =>
  [item.type, item.title, item.link, item.actor ?? ""].join("|");

const toDate = (value?: string | Date | null) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function Dashboard() {
  const { data: members, loading: membersLoading, clubId } = useMembers();
  const { data: events, loading: eventsLoading } = useEvents();
  const { data: announcements, loading: announcementsLoading } = useAnnouncements();
  const { data: socialPosts, loading: socialPostsLoading } = useSocialPosts();
  const { data: forms, loading: formsLoading } = useForms();
  const { data: galleryImages, loading: galleryLoading } = useGalleryImages();
  const { data: messages, loading: messagesLoading } = useMessages();
  const { data: groupChats, loading: groupChatsLoading } = useGroupChats();
  const { data: transactions, loading: transactionsLoading } = useTransactions();
  const { data: pointEntries, loading: pointsLoading } = usePointEntries();
  const { user, loading: userLoading } = useCurrentUser();
  const { canEditContent, loading: roleLoading } = useCurrentUserRole();
  const memberNameByEmail = useMemo(() => {
    return new Map(
      members.map(member => [normalizeEmail(member.email), member.name])
    );
  }, [members]);
  const resolveMemberName = (email: string) => {
    return memberNameByEmail.get(normalizeEmail(email)) ?? email;
  };
  const [missedOpen, setMissedOpen] = React.useState(false);
  const [missedLoading, setMissedLoading] = React.useState(false);
  const [missedTitle, setMissedTitle] = React.useState("What you missed");
  const [missedBullets, setMissedBullets] = React.useState<string[]>([]);
  const [missedActions, setMissedActions] = React.useState<
    { label: string; href: string }[]
  >([]);
  const [missedDismissed, setMissedDismissed] = React.useState(false);
  const [missedTypingStart, setMissedTypingStart] = React.useState(0);
  const [missedNow, setMissedNow] = React.useState(() => Date.now());
  const { data: dashboardState, updateData: updateDashboardState } =
    useGroupUserStateSection<DashboardStoredState>("dashboard", DEFAULT_DASHBOARD_STATE);

  const hasClub = Boolean(clubId);
  const isAuthLoading = userLoading || roleLoading;
  const isDataLoading =
    membersLoading ||
    eventsLoading ||
    announcementsLoading ||
    socialPostsLoading ||
    formsLoading ||
    galleryLoading ||
    messagesLoading ||
    groupChatsLoading ||
    transactionsLoading ||
    pointsLoading;

  useEffect(() => {
    if (!missedOpen || missedLoading) return;
    const startAt = Date.now();
    setMissedTypingStart(startAt);
    setMissedNow(startAt);
    const interval = setInterval(() => setMissedNow(Date.now()), 40);
    return () => clearInterval(interval);
  }, [missedOpen, missedLoading]);
  
  useEffect(() => {
    setMissedDismissed(false);
  }, [clubId, user?.email]);

  const dismissMissed = React.useCallback(() => {
    setMissedOpen(false);
    setMissedDismissed(true);
    const now = Date.now();
    void updateDashboardState(prev => ({
      ...prev,
      missedLastSeenAt: now,
      missedLastShownDay: getUtcDayKey(new Date(now)),
    }));
  }, [updateDashboardState]);

  const upcomingEvent = events.length > 0 ? [...events].sort((a,b) => a.date.getTime() - b.date.getTime())[0] : null;
  const upcomingWeekEvents = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return events
      .filter(event => event.date >= now && event.date <= end)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events]);

  const mostRecentActivity = useMemo(() => {
    const allActivities = [
        ...announcements.map(a => ({...a, type: 'announcement', date: new Date(a.date), link: '/announcements' })),
        ...socialPosts.map(p => ({...p, type: 'social', date: new Date(p.date), link: '/social' })),
        ...events.map(e => ({...e, type: 'event', date: e.date, link: '/calendar' }))
    ];

    if (allActivities.length === 0) return null;

    return allActivities.sort((a, b) => b.date.getTime() - a.date.getTime())[0];

  }, [announcements, socialPosts, events]);

  const activityIcon = useMemo(() => {
    if (!mostRecentActivity) return Activity;
    switch (mostRecentActivity.type) {
      case 'announcement': return Megaphone;
      case 'social': return Network;
      case 'event': return CalendarDays;
      default: return Activity;
    }
  }, [mostRecentActivity]);

  const recentActivities = useMemo<ActivityItem[]>(() => {
    const userEmail = normalizeEmail(user?.email);
    const items: ActivityItem[] = [];

    const isSeenByUser = (emails?: string[]) => {
      if (!userEmail) return false;
      return (emails ?? []).some(email => normalizeEmail(email) === userEmail);
    };

    announcements.forEach(announcement => {
      if (userEmail && (announcement.read || isSeenByUser(announcement.viewedBy))) {
        return;
      }
      const date = toDate(announcement.date);
      if (!date) return;
      items.push({
        type: 'announcement',
        title: announcement.title,
        date,
        link: '/announcements',
        actor: normalizeEmail(announcement.author) || null,
      });
    });

    socialPosts.forEach(post => {
      if (userEmail && post.read) return;
      const date = toDate(post.date);
      if (!date) return;
      items.push({
        type: 'social',
        title: post.title ?? 'Social post',
        date,
        link: '/gallery',
        actor: normalizeEmail(post.author) || null,
      });
    });

    events.forEach(event => {
      if (userEmail && (event.read || isSeenByUser(event.viewedBy))) {
        return;
      }
      if (!(event.date instanceof Date)) return;
      items.push({
        type: 'event',
        title: event.title,
        date: event.date,
        link: '/calendar',
        actor: null,
      });
    });

    (forms ?? []).forEach(form => {
      if (userEmail && (form.viewedBy ?? []).map(normalizeEmail).includes(userEmail)) {
        return;
      }
      const createdAt = toDate(form.createdAt);
      if (createdAt) {
        items.push({
          type: 'form',
          title: `New form: ${form.title}`,
          date: createdAt,
          link: '/forms',
          actor: normalizeEmail(form.createdBy) || null,
        });
      }
      (form.responses ?? []).forEach(response => {
        if (normalizeEmail(response.respondentEmail) === userEmail) return;
        const date = toDate(response.submittedAt);
        if (!date) return;
        items.push({
          type: 'form',
          title: `${form.title} response`,
          date,
          link: '/forms',
          actor: normalizeEmail(response.respondentEmail) || null,
        });
      });
    });

    (galleryImages ?? [])
      .filter(image => image.status === 'approved')
      .forEach(image => {
        if (userEmail && image.read) return;
        const date = toDate(image.date);
        if (!date) return;
        items.push({
          type: 'gallery',
          title: `${resolveMemberName(image.author)} uploaded ${image.alt ?? "a photo"}`,
          date,
          link: '/gallery',
          actor: normalizeEmail(image.author) || null,
        });
      });

    Object.values(messages ?? {}).flat().forEach(message => {
      if (!userEmail) return;
      if (normalizeEmail(message.sender) === userEmail) return;
      if ((message.readBy ?? []).some(email => normalizeEmail(email) === userEmail)) {
        return;
      }
      const date = toDate(message.timestamp);
      if (!date) return;
      items.push({
        type: 'message',
        title: `Message from ${resolveMemberName(message.sender)}`,
        date,
        link: '/messages',
        actor: normalizeEmail(message.sender) || null,
      });
    });

    (groupChats ?? []).forEach(chat => {
      (chat.messages ?? []).forEach(message => {
        if (!userEmail) return;
        if (normalizeEmail(message.sender) === userEmail) return;
        if ((message.readBy ?? []).some(email => normalizeEmail(email) === userEmail)) {
          return;
        }
        const date = toDate(message.timestamp);
        if (!date) return;
        items.push({
          type: 'group message',
          title: `${chat.name} message from ${resolveMemberName(message.sender)}`,
          date,
          link: '/messages',
          actor: normalizeEmail(message.sender) || null,
        });
      });
    });

    if (canEditContent) {
      (transactions ?? []).forEach(transaction => {
        const date = toDate(transaction.date);
        if (!date) return;
        items.push({
          type: 'finance',
          title: transaction.description ?? 'Transaction',
          date,
          link: '/finances',
          actor: null,
        });
      });
    }

    (pointEntries ?? []).forEach(entry => {
      if (normalizeEmail(entry.awardedBy) === userEmail) return;
      const date = toDate(entry.date);
      if (!date) return;
      items.push({
        type: 'points',
        title: `${resolveMemberName(entry.memberEmail)} earned ${entry.points} points`,
        date,
        link: '/points',
        actor: normalizeEmail(entry.awardedBy) || null,
      });
    });

    const filtered = userEmail
      ? items.filter(item => !item.actor || item.actor !== userEmail)
      : items;

    return filtered.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [
    announcements,
    events,
    forms,
    galleryImages,
    groupChats,
    messages,
    pointEntries,
    socialPosts,
    transactions,
    canEditContent,
    user?.email,
    memberNameByEmail,
  ]);

  const todoItems = useMemo(() => {
    const items: { text: string; href: string }[] = [];
    const userEmail = normalizeEmail(user?.email);
    if (!userEmail) return items;

    const unreadDmCount = Object.values(messages ?? {})
      .flat()
      .filter(
        msg =>
          normalizeEmail(msg.sender) !== userEmail &&
          !(msg.readBy ?? []).some(email => normalizeEmail(email) === userEmail)
      ).length;
    const unreadGroupCount = (groupChats ?? [])
      .flatMap(chat => chat.messages ?? [])
      .filter(
        msg =>
          normalizeEmail(msg.sender) !== userEmail &&
          !(msg.readBy ?? []).some(email => normalizeEmail(email) === userEmail)
      ).length;
    const unreadMessages = unreadDmCount + unreadGroupCount;

    if (unreadMessages > 0) {
      items.push({
        text: `Reply to ${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}.`,
        href: "/messages",
      });
    }

    if (!canEditContent) {
      const pendingForms = (forms ?? []).filter(form => {
        const responses = form.responses ?? [];
        return !responses.some(
          response => normalizeEmail(response.respondentEmail) === userEmail
        );
      });
      if (pendingForms.length > 0) {
        items.push({
          text: `Complete ${pendingForms.length} pending form${pendingForms.length === 1 ? "" : "s"}.`,
          href: "/forms",
        });
      }

      const pendingRsvps = events.filter(event => {
        if (!event.rsvpRequired) return false;
        const yes = event.rsvps?.yes ?? [];
        const no = event.rsvps?.no ?? [];
        const maybe = event.rsvps?.maybe ?? [];
        return ![...yes, ...no, ...maybe]
          .map(normalizeEmail)
          .includes(userEmail);
      });
      if (pendingRsvps.length > 0) {
        items.push({
          text: `RSVP for ${pendingRsvps.length} upcoming event${pendingRsvps.length === 1 ? "" : "s"}.`,
          href: "/calendar",
        });
      }
    } else {
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const recentAnnouncements = announcements.filter(announcement => {
        const date = toDate(announcement.date);
        return date && date >= weekAgo;
      });
      if (upcomingWeekEvents.length > 0 && recentAnnouncements.length === 0) {
        items.push({
          text: "Post a reminder announcement for upcoming events.",
          href: "/announcements",
        });
      }
    }

    return items.slice(0, 5);
  }, [
    announcements,
    canEditContent,
    events,
    forms,
    groupChats,
    messages,
    upcomingWeekEvents.length,
    user?.email,
  ]);

  const getActionLabel = (link: string) =>
    link === "/announcements"
      ? "Announcements"
      : link === "/calendar"
      ? "Calendar"
      : link === "/messages"
      ? "Messages"
      : link === "/forms"
      ? "Forms"
      : link === "/members"
      ? "Members"
      : link === "/gallery"
      ? "Gallery"
      : link === "/finances"
      ? "Finances"
      : link === "/attendance"
      ? "Attendance"
      : link === "/points"
      ? "Points"
      : "View";

  useEffect(() => {
    if (
      membersLoading ||
      eventsLoading ||
      announcementsLoading ||
      socialPostsLoading ||
      formsLoading ||
      galleryLoading ||
      messagesLoading ||
      groupChatsLoading ||
      transactionsLoading ||
      pointsLoading ||
      userLoading ||
      roleLoading ||
      !clubId ||
      !user?.email
    ) {
      return;
    }
    if (missedDismissed) {
      return;
    }
    const userEmail = normalizeEmail(user.email);
    const snapshot = dashboardState.missedSnapshot ?? DEFAULT_DASHBOARD_STATE.missedSnapshot;
    const shownActivityKeys = new Set(dashboardState.shownMissedActivityKeys ?? []);

    const deltaActivities: ActivityItem[] = [];
    const currentMemberEmails = members.map(member =>
      normalizeEmail(member.email)
    );
    const previousMembers = Array.isArray(snapshot.members) ? snapshot.members : [];
    const newMembers = currentMemberEmails.filter(
      email => email && !previousMembers.includes(email) && email !== userEmail
    );
    if (newMembers.length > 0) {
      const displayNames = newMembers
        .map(email => resolveMemberName(email))
        .slice(0, 3);
      const suffix = newMembers.length > 3 ? ", ..." : "";
      deltaActivities.push({
        type: "member",
        title: `New members: ${displayNames.join(", ")}${suffix}`,
        date: new Date(),
        link: "/members",
        actor: null,
      });
    }

    const currentEventIds = events.map(event => event.id);
    const previousEventIds = Array.isArray(snapshot.events) ? snapshot.events : [];
    events.forEach(event => {
      if (!previousEventIds.includes(event.id)) {
        deltaActivities.push({
          type: "event",
          title: `New event: ${event.title}`,
          date: new Date(),
          link: "/calendar",
          actor: null,
        });
      }
    });

    const previousRsvps =
      snapshot.rsvps && typeof snapshot.rsvps === "object" ? snapshot.rsvps : {};
    const previousAttendees =
      snapshot.attendees && typeof snapshot.attendees === "object"
        ? snapshot.attendees
        : {};
    const nextRsvps: Record<string, { yes: string[]; no: string[]; maybe: string[] }> =
      {};
    const nextAttendees: Record<string, string[]> = {};

    events.forEach(event => {
      const currentYes = Array.isArray(event.rsvps?.yes)
        ? event.rsvps?.yes.map(normalizeEmail).filter(Boolean)
        : [];
      const currentNo = Array.isArray(event.rsvps?.no)
        ? event.rsvps?.no.map(normalizeEmail).filter(Boolean)
        : [];
      const currentMaybe = Array.isArray(event.rsvps?.maybe)
        ? event.rsvps?.maybe.map(normalizeEmail).filter(Boolean)
        : [];

      const previous = previousRsvps[event.id] ?? { yes: [], no: [], maybe: [] };
      const newYes = currentYes.filter(email => !previous.yes.includes(email));
      const newNo = currentNo.filter(email => !previous.no.includes(email));
      const newMaybe = currentMaybe.filter(
        email => !previous.maybe.includes(email)
      );
      const newRsvpCount =
        [...newYes, ...newNo, ...newMaybe].filter(email => email !== userEmail)
          .length;

      if (newRsvpCount > 0) {
        deltaActivities.push({
          type: "rsvp",
          title: `${newRsvpCount} new RSVP${newRsvpCount === 1 ? "" : "s"} for ${
            event.title
          }`,
          date: new Date(),
          link: "/calendar",
          actor: null,
        });
      }

      nextRsvps[event.id] = {
        yes: currentYes,
        no: currentNo,
        maybe: currentMaybe,
      };

      const currentAttendees = Array.isArray(event.attendees)
        ? event.attendees.map(normalizeEmail).filter(Boolean)
        : [];
      const previousEventAttendees = previousAttendees[event.id] ?? [];
      const newAttendees = currentAttendees.filter(
        email => !previousEventAttendees.includes(email) && email !== userEmail
      );
      if (newAttendees.length > 0) {
        deltaActivities.push({
          type: "attendance",
          title: `${newAttendees.length} new check-in${
            newAttendees.length === 1 ? "" : "s"
          } for ${event.title}`,
          date: new Date(),
          link: "/attendance",
          actor: null,
        });
      }
      nextAttendees[event.id] = currentAttendees;
    });

    const allActivities = [...recentActivities, ...deltaActivities].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );
    const unseen = allActivities.filter(item => !shownActivityKeys.has(createActivityKey(item)));
    const unseenForPopup = unseen.slice(0, 6);
    const unseenPopupKeys = unseenForPopup.map(item => createActivityKey(item));

    const missedContextVersion = stableSerialize({
      unseen: unseenForPopup.map(item => ({
        type: item.type,
        title: item.title,
        link: item.link,
        actor: item.actor,
      })),
      upcoming: upcomingWeekEvents.slice(0, 5).map(event => ({
        id: event.id,
        title: event.title,
        date: event.date.toISOString(),
      })),
      todo: todoItems.slice(0, 5),
    });

    if (unseen.length >= 3 && !missedOpen) {
      setMissedLoading(true);
      const cachedSummary = dashboardState.missedSummaryCache;
      const nextSummary =
        cachedSummary?.contextVersion === missedContextVersion
          ? cachedSummary
          : {
              contextVersion: missedContextVersion,
              title: "What you missed",
              bullets: unseenForPopup.map(item => `${item.title} (${item.date.toLocaleDateString()})`),
              actions: Array.from(new Set(unseenForPopup.map(item => item.link)))
                .slice(0, 3)
                .map(link => ({
                  href: link,
                  label: getActionLabel(link),
                })),
            };

      setMissedTitle(nextSummary.title);
      setMissedBullets(nextSummary.bullets);
      setMissedActions(nextSummary.actions);
      setMissedOpen(true);
      setMissedLoading(false);

      void updateDashboardState(prev => ({
        ...prev,
        missedSummaryCache: nextSummary,
        shownMissedActivityKeys: Array.from(
          new Set([...(prev.shownMissedActivityKeys ?? []), ...unseenPopupKeys])
        ).slice(-200),
        missedSnapshot: {
          members: currentMemberEmails,
          events: currentEventIds,
          rsvps: nextRsvps,
          attendees: nextAttendees,
        },
      }));
    } else {
      void updateDashboardState(prev => ({
        ...prev,
        missedSnapshot: {
          members: currentMemberEmails,
          events: currentEventIds,
          rsvps: nextRsvps,
          attendees: nextAttendees,
        },
      }));
    }
  }, [
    announcementsLoading,
    clubId,
    dashboardState.shownMissedActivityKeys,
    dashboardState.missedSnapshot,
    dashboardState.missedSummaryCache,
    events,
    eventsLoading,
    members,
    formsLoading,
    galleryLoading,
    groupChatsLoading,
    membersLoading,
    messagesLoading,
    missedOpen,
    pointsLoading,
    recentActivities,
    roleLoading,
    socialPostsLoading,
    todoItems,
    transactionsLoading,
    upcomingWeekEvents,
    updateDashboardState,
    user?.email,
    userLoading,
  ]);

  if (isAuthLoading) {
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

  if (!hasClub) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>No group selected</CardTitle>
            <CardDescription>
              Choose a group to view your dashboard, or create/join a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">Go to group selection</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/clubs">Your groups</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isDataLoading) {
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

  return (
    <div className="flex flex-col gap-4 md:gap-8">
      <Dialog
        open={missedOpen}
        onOpenChange={(open) => {
          if (open) {
            setMissedOpen(true);
            return;
          }
          dismissMissed();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent animate-in fade-in duration-700">
                {missedTitle}
              </span>
            </DialogTitle>
            <DialogDescription>
              Here&apos;s what changed while you were away.
            </DialogDescription>
          </DialogHeader>
          {missedLoading ? (
            <div className="text-sm text-muted-foreground">Summarizing updates...</div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent animate-in fade-in duration-700">
                    New
                  </span>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                {missedBullets.length === 0 ? (
                    <li className="animate-in fade-in duration-700 text-muted-foreground">
                      No new updates.
                    </li>
                  ) : (
                    missedBullets.map((bullet, index) => (
                      <li
                        key={`${bullet}-${index}`}
                        className="animate-in fade-in duration-700"
                      >
                        {typewriterText({
                          text: bullet,
                          startAt: missedTypingStart + index * 120,
                          now: missedNow,
                        })}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent animate-in fade-in duration-700">
                    Upcoming
                  </span>
                </div>
                {upcomingWeekEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground animate-in fade-in duration-700">
                    No events this week.
                  </p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {upcomingWeekEvents.slice(0, 5).map((event, index) => (
                      <li key={event.id} className="animate-in fade-in duration-700">
                        {typewriterText({
                          text: `${event.title} (${event.date.toLocaleDateString()})`,
                          startAt:
                            missedTypingStart +
                            missedBullets.length * 120 +
                            200 +
                            index * 120,
                          now: missedNow,
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent animate-in fade-in duration-700">
                    To do
                  </span>
                </div>
                {todoItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground animate-in fade-in duration-700">
                    You&apos;re all caught up.
                  </p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {todoItems.map((item, index) => (
                      <li key={item.text} className="animate-in fade-in duration-700">
                        <Link href={item.href} className="hover:underline">
                          {typewriterText({
                            text: item.text,
                            startAt:
                              missedTypingStart +
                              (missedBullets.length + upcomingWeekEvents.length) * 120 +
                              400 +
                              index * 120,
                            now: missedNow,
                          })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {missedActions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {missedActions.map(action => (
                    <Button asChild variant="outline" size="sm" key={action.href}>
                      <Link href={action.href}>{action.label}</Link>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button onClick={dismissMissed}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AIInsights
        clubId={clubId}
        userId={user?.email}
        mode={canEditContent ? "officer" : "member"}
      />
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upcoming events</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{events.length}</div>
            <p className="text-xs text-muted-foreground">Events on the calendar.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total members</CardTitle>
            <UsersRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members.length}</div>
            <p className="text-xs text-muted-foreground">The heart of your club.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upcoming event</CardTitle>
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
            <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
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
