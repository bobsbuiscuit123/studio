
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
import { useNotificationsContext } from "@/components/notifications-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useMemo } from "react";
import AIInsights from "@/components/officer/ai-insights";
import { useGroupUserStateSection } from "@/lib/group-user-state";
import { getUtcDayKey } from "@/lib/day-key";
import { buildDashboardMissedPopupItems } from "@/lib/dashboard-missed-activity";
import {
  createEmptyGroupActivitySnapshot,
  createGroupActivitySnapshot,
  isGroupActivitySnapshotEmpty,
  type GroupActivitySnapshot,
} from "@/lib/notification-state";
import { stableSerialize } from "@/lib/stable-serialize";
import {
  buildNotificationHref,
  getMessageEntityId,
  routeFromNotification,
  type AppNotification,
} from "@/lib/notification-routing";
import { getSelectedOrgId } from "@/lib/selection";

type ActivityItem = {
  type: string;
  title: string;
  date: Date;
  href: string;
  actor: string | null;
  notification?: AppNotification;
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
  lastMissedContextVersionShown: string | null;
  shownMissedActivityKeys: string[];
  missedSnapshot: GroupActivitySnapshot;
  missedSummaryCache: MissedActivityCache | null;
};

const DEFAULT_DASHBOARD_STATE: DashboardStoredState = {
  missedLastSeenAt: 0,
  missedLastShownDay: null,
  lastMissedContextVersionShown: null,
  shownMissedActivityKeys: [],
  missedSnapshot: createEmptyGroupActivitySnapshot(),
  missedSummaryCache: null,
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
  const {
    groupSessionEntrySnapshot,
    groupSessionReady,
    groupSessionStartedAt,
    sessionViewedRoutes,
  } = useNotificationsContext();
  const selectedOrgId = getSelectedOrgId();
  const buildEntityHref = (notification: AppNotification | null, fallbackHref: string) =>
    notification ? buildNotificationHref(routeFromNotification(notification)) : fallbackHref;
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
  const currentMissedSnapshot = useMemo(
    () =>
      createGroupActivitySnapshot({
        members,
        events,
      }),
    [events, members]
  );
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
        ...announcements.map(a => ({
          ...a,
          type: 'announcement',
          date: new Date(a.date),
          href: buildEntityHref(
            selectedOrgId && clubId
              ? {
                  schema_version: 1,
                  id: `announcement-${a.id}`,
                  user_id: user?.email ?? 'current-user',
                  org_id: selectedOrgId,
                  group_id: clubId,
                  type: 'announcement',
                  entity_id: String(a.id),
                  created_at: a.date,
                  read: Boolean(a.read),
                }
              : null,
            '/announcements'
          ),
        })),
        ...socialPosts.map(p => ({...p, type: 'social', date: new Date(p.date), href: '/gallery' })),
        ...events.map(e => ({
          ...e,
          type: 'event',
          date: e.date,
          href: buildEntityHref(
            selectedOrgId && clubId
              ? {
                  schema_version: 1,
                  id: `event-${e.id}`,
                  user_id: user?.email ?? 'current-user',
                  org_id: selectedOrgId,
                  group_id: clubId,
                  type: 'event',
                  entity_id: e.id,
                  created_at: e.date.toISOString(),
                  read: Boolean(e.read),
                }
              : null,
            '/calendar'
          ),
        }))
    ];

    if (allActivities.length === 0) return null;

    return allActivities.sort((a, b) => b.date.getTime() - a.date.getTime())[0];

  }, [announcements, buildEntityHref, clubId, events, selectedOrgId, socialPosts, user?.email]);

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
        href: buildEntityHref(
          selectedOrgId && clubId
            ? {
                schema_version: 1,
                id: `announcement-${announcement.id}`,
                user_id: user?.email ?? 'current-user',
                org_id: selectedOrgId,
                group_id: clubId,
                type: 'announcement',
                entity_id: String(announcement.id),
                created_at: announcement.date,
                read: Boolean(announcement.read),
              }
            : null,
          '/announcements'
        ),
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
        href: '/gallery',
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
        href: buildEntityHref(
          selectedOrgId && clubId
            ? {
                schema_version: 1,
                id: `event-${event.id}`,
                user_id: user?.email ?? 'current-user',
                org_id: selectedOrgId,
                group_id: clubId,
                type: 'event',
                entity_id: event.id,
                created_at: event.date.toISOString(),
                read: Boolean(event.read),
              }
            : null,
          '/calendar'
        ),
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
          href: '/forms',
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
          href: '/forms',
          actor: normalizeEmail(response.respondentEmail) || null,
        });
      });
    });

    (galleryImages ?? []).forEach(image => {
        if (userEmail && image.read) return;
        const date = toDate(image.date);
        if (!date) return;
        items.push({
          type: 'gallery',
          title: `${resolveMemberName(image.author)} uploaded ${image.alt ?? "a photo"}`,
          date,
          href: '/gallery',
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
        href: buildEntityHref(
          selectedOrgId && clubId
            ? {
                schema_version: 1,
                id: `message-${getMessageEntityId(message)}`,
                user_id: user?.email ?? 'current-user',
                org_id: selectedOrgId,
                group_id: clubId,
                type: 'message',
                entity_id: getMessageEntityId(message),
                parent_id: message.sender,
                parent_type: 'dm',
                created_at: message.timestamp,
                read: false,
              }
            : null,
          '/messages'
        ),
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
          href: buildEntityHref(
            selectedOrgId && clubId
              ? {
                  schema_version: 1,
                  id: `message-${getMessageEntityId(message)}`,
                  user_id: user?.email ?? 'current-user',
                  org_id: selectedOrgId,
                  group_id: clubId,
                  type: 'message',
                  entity_id: getMessageEntityId(message),
                  parent_id: chat.id,
                  parent_type: 'group',
                  created_at: message.timestamp,
                  read: false,
                }
              : null,
            '/messages'
          ),
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
          href: '/finances',
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
        href: '/points',
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
    buildEntityHref,
    clubId,
    selectedOrgId,
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
      !groupSessionReady ||
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
    const hasMissedBaseline =
      dashboardState.missedLastSeenAt > 0 ||
      dashboardState.lastMissedContextVersionShown !== null ||
      (dashboardState.shownMissedActivityKeys?.length ?? 0) > 0 ||
      !isGroupActivitySnapshotEmpty(snapshot);

    if (!hasMissedBaseline) {
      void updateDashboardState(prev => ({
        ...prev,
        missedLastSeenAt: prev.missedLastSeenAt || Date.now(),
        missedSnapshot: currentMissedSnapshot,
      }));
      return;
    }

    const unseen = buildDashboardMissedPopupItems({
      announcements,
      baselineReady: hasMissedBaseline,
      events,
      forms,
      groupChats,
      members,
      messages,
      persistedSnapshot: snapshot,
      resolveMemberName,
      sessionSnapshot: groupSessionEntrySnapshot,
      groupSessionStartedAt,
      shownActivityKeys,
      suppressedRoutes: new Set(sessionViewedRoutes),
      timeBaselineStartedAt: dashboardState.missedLastSeenAt,
      userEmail,
    });
    const unseenForPopup = unseen.slice(0, 6);
    const unseenPopupKeys = unseenForPopup.flatMap(item => item.keys);

    const missedUnseenVersion = stableSerialize({
      unseen: unseenForPopup.map(item => ({
        keys: item.keys,
        type: item.type,
        title: item.title,
        href: item.link,
        actor: item.actor,
        date: item.date.toISOString(),
      })),
    });

    if (
      unseen.length >= 3 &&
      !missedOpen &&
      dashboardState.lastMissedContextVersionShown !== missedUnseenVersion
    ) {
      setMissedLoading(true);
      const cachedSummary = dashboardState.missedSummaryCache;
      const nextSummary =
        cachedSummary?.contextVersion === missedUnseenVersion
          ? cachedSummary
          : {
              contextVersion: missedUnseenVersion,
              title: "What you missed",
              bullets: unseenForPopup.map(item => `${item.title} (${item.date.toLocaleDateString()})`),
              actions: Array.from(new Set(unseenForPopup.map(item => item.link)))
                .slice(0, 3)
                .map(href => ({
                  href,
                  label: getActionLabel(href),
                })),
            };

      setMissedTitle(nextSummary.title);
      setMissedBullets(nextSummary.bullets);
      setMissedActions(nextSummary.actions);
      setMissedOpen(true);
      setMissedLoading(false);

      void updateDashboardState(prev => ({
        ...prev,
        lastMissedContextVersionShown: missedUnseenVersion,
        missedSummaryCache: nextSummary,
        shownMissedActivityKeys: Array.from(
          new Set([...(prev.shownMissedActivityKeys ?? []), ...unseenPopupKeys])
        ).slice(-200),
        missedSnapshot: currentMissedSnapshot,
      }));
    } else {
      void updateDashboardState(prev => ({
        ...prev,
        missedSnapshot: currentMissedSnapshot,
      }));
    }
  }, [
    announcements,
    announcementsLoading,
    clubId,
    currentMissedSnapshot,
    dashboardState.missedLastSeenAt,
    dashboardState.shownMissedActivityKeys,
    dashboardState.missedSnapshot,
    dashboardState.missedSummaryCache,
    dashboardState.lastMissedContextVersionShown,
    events,
    eventsLoading,
    forms,
    members,
    formsLoading,
    galleryLoading,
    groupChats,
    groupChatsLoading,
    groupSessionEntrySnapshot,
    groupSessionReady,
    groupSessionStartedAt,
    membersLoading,
    messages,
    messagesLoading,
    missedOpen,
    pointsLoading,
    roleLoading,
    sessionViewedRoutes,
    socialPostsLoading,
    transactionsLoading,
    updateDashboardState,
    user?.email,
    userLoading,
  ]);

  if (isAuthLoading) {
    return (
      <div className="tab-page-shell">
        <div className="tab-page-content">
      <div className="flex flex-col gap-4 pt-2 md:gap-8">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
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
        </div>
      </div>
    );
  }

  if (!hasClub) {
    return (
      <div className="tab-page-shell">
        <div className="tab-page-content">
      <div className="flex flex-col gap-6 pt-2">
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
        </div>
      </div>
    );
  }

  if (isDataLoading) {
    return (
      <div className="tab-page-shell">
        <div className="tab-page-content">
       <div className="flex flex-col gap-4 pt-2 md:gap-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
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
        </div>
      </div>
    );
  }

  return (
    <div className="tab-page-shell">
      <div className="tab-page-content">
    <div className="flex flex-col gap-4 pt-2 md:gap-8">
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
        <Card className="mobile-panel">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upcoming events</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{events.length}</div>
            <p className="text-xs text-muted-foreground">Events on the calendar.</p>
          </CardContent>
        </Card>
        <Card className="mobile-panel">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total members</CardTitle>
            <UsersRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members.length}</div>
            <p className="text-xs text-muted-foreground">The heart of your club.</p>
          </CardContent>
        </Card>
        <Card className="mobile-panel">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upcoming event</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
             {upcomingEvent ? (
              <>
                <div className="text-lg font-bold leading-tight sm:text-2xl">{upcomingEvent.title}</div>
                <p className="text-xs text-muted-foreground">
                  {upcomingEvent.date.toLocaleDateString()}
                </p>
              </>
            ) : (
              <div className="text-xl font-semibold text-muted-foreground">No upcoming events</div>
            )}
          </CardContent>
        </Card>
        <Card className="mobile-panel">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
            {React.createElement(activityIcon, { className: "h-4 w-4 text-muted-foreground" })}
          </CardHeader>
          <CardContent>
            {mostRecentActivity ? (
                 <Link href={mostRecentActivity.href}>
                    <div className="text-lg font-bold leading-tight hover:underline sm:text-2xl" title={mostRecentActivity.title}>
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
        <Card className="mobile-panel xl:col-span-2">
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
            <>
              <div className="space-y-3 md:hidden">
                {members.slice(0, 5).map((member) => (
                  <div key={member.email} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                    <div className="font-medium leading-tight">{member.name}</div>
                    <div className="mt-1 break-all text-xs text-muted-foreground">
                      {member.email}
                    </div>
                    <Badge variant="outline" className="mt-3">
                      {member.role}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
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
              </div>
            </>
            ) : (
               <div className="text-center py-8 text-muted-foreground">No members yet.</div>
            )}
          </CardContent>
        </Card>
        <Card className="mobile-panel">
          <CardHeader>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>
              Don't miss out on these upcoming events.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {events.slice(0, 3).map((event, index) => (
              <div key={index} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div className="grid min-w-0 gap-1">
                  <p className="text-sm font-medium leading-snug">
                    {event.title}
                  </p>
                  <p className="text-xs text-muted-foreground sm:text-sm">
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
      </div>
    </div>
  );
}
