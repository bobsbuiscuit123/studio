import type { Announcement, ClubEvent, ClubForm, GalleryImage, Member, PointEntry, SocialPost } from '@/lib/mock-data';

export type CommandCenterAlert = {
  id: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  orgId?: string;
  orgName?: string;
  groupId?: string;
  groupName?: string;
  timestamp?: string | null;
};

export type HeatmapCell = {
  day: string;
  hour: number;
  label: string;
  count: number;
};

export type SparklinePoint = {
  day: string;
  count: number;
};

export type SponsorSummary = {
  name: string;
  email: string;
};

export type OrgDashboardGroupRow = {
  groupId: string;
  groupName: string;
  sponsor: SponsorSummary | null;
  memberCount: number;
  lastActivityDate: string | null;
  lastMeetingDate: string | null;
  status: 'active' | 'inactive' | 'alert';
  statusLabel: 'Active' | 'Inactive/No Meeting' | 'No Sponsor/Alert';
  compliant: boolean;
  resourceHours: number;
};

export type OrgDashboardPayload = {
  org: {
    id: string;
    name: string;
    totalStudentBody: number;
  };
  kpis: {
    totalActiveMembers: number;
    weeklyMeetingDensity: number;
    engagementPercent: number | null;
    compliancePercent: number | null;
    tasksAutomated: number;
  };
  groups: OrgDashboardGroupRow[];
  auditLog: CommandCenterAlert[];
  heatmap: HeatmapCell[];
  exportRows: EngagementReportRow[];
};

export type ExecutiveCampusCard = {
  orgId: string;
  orgName: string;
  totalGroups: number;
  engagementPercent: number | null;
  impactedStudents: number;
  compliancePercent: number | null;
  resourceHours: number;
  tasksAutomated: number;
  healthSparkline: SparklinePoint[];
};

export type SearchIndexEntry = {
  id: string;
  type: 'student' | 'teacher' | 'club';
  label: string;
  detail: string;
  orgId: string;
  orgName: string;
  groupId?: string;
  groupName?: string;
};

export type ExecutiveDashboardPayload = {
  ownedOrgCount: number;
  kpis: {
    totalImpactedStudents: number;
    districtCompliancePercent: number | null;
    totalResourceHours: number;
    tasksAutomated: number;
  };
  campuses: ExecutiveCampusCard[];
  systemAlerts: CommandCenterAlert[];
  searchIndex: SearchIndexEntry[];
  exportRows: EngagementReportRow[];
};

export type RawGroupState = Record<string, unknown> | null | undefined;

export type RawGroupInput = {
  id: string;
  name: string;
  state?: RawGroupState;
};

export type RawOrgInput = {
  id: string;
  name: string;
  usageEstimateMembers?: number | null;
};

export type AssistantActionLogInput = {
  id?: string | null;
  org_id?: string | null;
  group_id?: string | null;
  action_type?: string | null;
  result?: string | null;
  error_message?: string | null;
  created_at?: string | null;
};

export type EngagementReportRow = {
  orgName: string;
  groupName: string;
  activeMembers: number;
  sponsor: string;
  lastActivityDate: string;
  status: string;
  compliant: string;
  resourceHours: number;
  tasksAutomated: number;
};

type GroupAnalytics = OrgDashboardGroupRow & {
  members: Member[];
  events: Array<Record<string, any>>;
  announcements: Array<Record<string, any>>;
  forms: Array<Record<string, any>>;
  pointEntries: Array<Record<string, any>>;
  activityTimestamps: number[];
  alerts: CommandCenterAlert[];
  searchEntries: SearchIndexEntry[];
  tasksAutomated: number;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const COMMAND_CENTER_HEATMAP_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const normalizeCommandCenterEmail = (value: unknown) =>
  String(value ?? '').trim().toLowerCase();

const asArray = <T = Record<string, any>>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const toTimestamp = (value: unknown) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value));
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
};

const toIsoOrNull = (timestamp: number) =>
  timestamp > 0 ? new Date(timestamp).toISOString() : null;

const compactDate = (timestamp: number) => {
  if (timestamp <= 0) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp));
};

const getEventTimestamp = (event: Record<string, any>) => toTimestamp(event.date);
const getAnnouncementTimestamp = (announcement: Record<string, any>) => toTimestamp(announcement.date);
const getFormTimestamp = (form: Record<string, any>) =>
  Math.max(
    toTimestamp(form.createdAt),
    ...asArray<Record<string, any>>(form.responses).map(response => toTimestamp(response.submittedAt))
  );
const getPointTimestamp = (entry: Record<string, any>) => toTimestamp(entry.date);
const getGalleryTimestamp = (image: Record<string, any>) => toTimestamp(image.date);
const getSocialTimestamp = (post: Record<string, any>) => toTimestamp(post.date);

const uniqueEmailCount = (members: Member[]) => {
  const emails = new Set<string>();
  members.forEach(member => {
    const email = normalizeCommandCenterEmail(member.email);
    if (email) emails.add(email);
  });
  return emails.size;
};

const resolveSponsor = (members: Member[]): SponsorSummary | null => {
  const sponsor =
    members.find(member => String(member.role).toLowerCase() === 'admin') ??
    members.find(member => String(member.role).toLowerCase() === 'officer') ??
    null;
  if (!sponsor) return null;
  return {
    name: sponsor.name || sponsor.email || 'Sponsor',
    email: sponsor.email || '',
  };
};

const hasAttendanceEvidence = (event: Record<string, any>) =>
  asArray(event.attendanceRecords).length > 0 ||
  asArray(event.attendees).length > 0 ||
  (typeof event.checkInCode === 'string' && event.checkInCode.trim().length > 0);

const getResourceHours = (state: RawGroupState) => {
  const data = (state ?? {}) as Record<string, unknown>;
  const pointEntries = asArray<PointEntry>(data.pointEntries);
  const events = asArray<ClubEvent>(data.events);
  const manualHours = pointEntries.reduce((sum, entry) => {
    const value = Number(entry.points ?? 0);
    return value > 0 ? sum + value : sum;
  }, 0);
  const eventHours = events.reduce((sum, event) => {
    const points = Number(event.points ?? 0);
    if (points <= 0) return sum;
    const attendanceCount =
      Array.isArray(event.attendanceRecords) && event.attendanceRecords.length > 0
        ? new Set(event.attendanceRecords.map(record => normalizeCommandCenterEmail(record.email)).filter(Boolean)).size
        : new Set((event.attendees ?? []).map(normalizeCommandCenterEmail).filter(Boolean)).size;
    return sum + attendanceCount * points;
  }, 0);
  return manualHours + eventHours;
};

const collectActivityTimestamps = (state: RawGroupState) => {
  const data = (state ?? {}) as Record<string, unknown>;
  const timestamps = [
    ...asArray<Announcement>(data.announcements).map(getAnnouncementTimestamp),
    ...asArray<ClubEvent>(data.events).map(getEventTimestamp),
    ...asArray<ClubForm>(data.forms).map(getFormTimestamp),
    ...asArray<GalleryImage>(data.galleryImages).map(getGalleryTimestamp),
    ...asArray<SocialPost>(data.socialPosts).map(getSocialTimestamp),
    ...asArray<PointEntry>(data.pointEntries).map(getPointTimestamp),
  ];
  return timestamps.filter(timestamp => timestamp > 0);
};

const countAiTaggedItems = (state: RawGroupState, since: number) => {
  const data = (state ?? {}) as Record<string, unknown>;
  const taggedAnnouncements = asArray<Record<string, any>>(data.announcements).filter(
    item => item.aiTagged && getAnnouncementTimestamp(item) >= since
  ).length;
  const taggedEvents = asArray<Record<string, any>>(data.events).filter(
    item => item.aiTagged && getEventTimestamp(item) >= since
  ).length;
  return taggedAnnouncements + taggedEvents;
};

const buildSparkline = (timestamps: number[], now: Date): SparklinePoint[] => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 30 }).map((_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (29 - index));
    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);
    const count = timestamps.filter(timestamp => timestamp >= day.getTime() && timestamp < nextDay.getTime()).length;
    return {
      day: `${day.getMonth() + 1}/${day.getDate()}`,
      count,
    };
  });
};

const buildHeatmap = (groups: RawGroupInput[]) => {
  const cells = new Map<string, HeatmapCell>();
  DAY_LABELS.forEach(day => {
    COMMAND_CENTER_HEATMAP_HOURS.forEach(hour => {
      cells.set(`${day}-${hour}`, {
        day,
        hour,
        label: `${day} ${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'p' : 'a'}`,
        count: 0,
      });
    });
  });

  groups.forEach(group => {
    const state = (group.state ?? {}) as Record<string, unknown>;
    asArray<Record<string, any>>(state.events).forEach(event => {
      const timestamp = getEventTimestamp(event);
      if (timestamp <= 0) return;
      const date = new Date(timestamp);
      const hour = date.getHours();
      if (!COMMAND_CENTER_HEATMAP_HOURS.includes(hour)) return;
      const key = `${DAY_LABELS[date.getDay()]}-${hour}`;
      const cell = cells.get(key);
      if (cell) cell.count += 1;
    });
  });

  return Array.from(cells.values());
};

const buildGroupAnalytics = ({
  org,
  group,
  logs,
  now,
}: {
  org: RawOrgInput;
  group: RawGroupInput;
  logs: AssistantActionLogInput[];
  now: Date;
}): GroupAnalytics => {
  const state = (group.state ?? {}) as Record<string, unknown>;
  const members = asArray<Member>(state.members);
  const events = asArray<Record<string, any>>(state.events);
  const announcements = asArray<Record<string, any>>(state.announcements);
  const forms = asArray<Record<string, any>>(state.forms);
  const pointEntries = asArray<Record<string, any>>(state.pointEntries);
  const sponsor = resolveSponsor(members);
  const activityTimestamps = collectActivityTimestamps(state);
  const latestActivity = activityTimestamps.length > 0 ? Math.max(...activityTimestamps) : 0;
  const meetingTimestamps = events.map(getEventTimestamp).filter(timestamp => timestamp > 0);
  const latestMeeting = meetingTimestamps.length > 0 ? Math.max(...meetingTimestamps) : 0;
  const recentThreshold = now.getTime() - THIRTY_DAYS_MS;
  const recentEvents = events.filter(event => getEventTimestamp(event) >= recentThreshold);
  const resourceHours = getResourceHours(state);
  const groupLogs = logs.filter(log => log.group_id === group.id);
  const recentSuccessfulLogs = groupLogs.filter(
    log => log.result === 'success' && toTimestamp(log.created_at) >= recentThreshold
  ).length;
  const tasksAutomated = recentSuccessfulLogs + countAiTaggedItems(state, recentThreshold);
  const status: OrgDashboardGroupRow['status'] = !sponsor
    ? 'alert'
    : latestMeeting >= recentThreshold
      ? 'active'
      : 'inactive';
  const statusLabel: OrgDashboardGroupRow['statusLabel'] =
    status === 'alert' ? 'No Sponsor/Alert' : status === 'active' ? 'Active' : 'Inactive/No Meeting';
  const compliant =
    Boolean(sponsor) &&
    recentEvents.length > 0 &&
    recentEvents.every(event => hasAttendanceEvidence(event));

  const alerts: CommandCenterAlert[] = [];
  if (!sponsor) {
    alerts.push({
      id: `${group.id}-no-sponsor`,
      level: 'critical',
      title: 'No sponsor on record',
      detail: `${group.name} has no Admin or Officer listed as faculty sponsor.`,
      orgId: org.id,
      orgName: org.name,
      groupId: group.id,
      groupName: group.name,
      timestamp: toIsoOrNull(latestActivity),
    });
  }
  if (sponsor && latestMeeting < recentThreshold) {
    alerts.push({
      id: `${group.id}-inactive`,
      level: 'warning',
      title: 'No recent meeting detected',
      detail: `${group.name} has not logged a meeting in the last 30 days.`,
      orgId: org.id,
      orgName: org.name,
      groupId: group.id,
      groupName: group.name,
      timestamp: toIsoOrNull(latestMeeting || latestActivity),
    });
  }
  recentEvents.forEach(event => {
    const location = String(event.location ?? '');
    if (/off\s*campus|off-campus|restaurant|park|mall|home|field trip|away|external|outside/i.test(location)) {
      alerts.push({
        id: `${group.id}-${event.id ?? event.title}-off-campus`,
        level: 'warning',
        title: 'Off-campus location flagged',
        detail: `${group.name} scheduled "${event.title ?? 'Meeting'}" at ${location}.`,
        orgId: org.id,
        orgName: org.name,
        groupId: group.id,
        groupName: group.name,
        timestamp: toIsoOrNull(getEventTimestamp(event)),
      });
    }
    if (!hasAttendanceEvidence(event)) {
      alerts.push({
        id: `${group.id}-${event.id ?? event.title}-attendance`,
        level: 'warning',
        title: 'Attendance evidence missing',
        detail: `${group.name} has no attendance/check-in evidence for "${event.title ?? 'Meeting'}".`,
        orgId: org.id,
        orgName: org.name,
        groupId: group.id,
        groupName: group.name,
        timestamp: toIsoOrNull(getEventTimestamp(event)),
      });
    }
  });
  groupLogs
    .filter(log => log.result === 'failure')
    .slice(0, 4)
    .forEach(log => {
      alerts.push({
        id: `${group.id}-${log.id ?? log.created_at}-assistant-failure`,
        level: 'critical',
        title: 'Assistant action failed',
        detail: `${group.name}: ${log.action_type ?? 'AI task'} failed${log.error_message ? ` - ${log.error_message}` : ''}.`,
        orgId: org.id,
        orgName: org.name,
        groupId: group.id,
        groupName: group.name,
        timestamp: log.created_at ?? null,
      });
    });

  const searchEntries: SearchIndexEntry[] = [
    {
      id: `club:${group.id}`,
      type: 'club',
      label: group.name,
      detail: `${org.name} - ${members.length} members`,
      orgId: org.id,
      orgName: org.name,
      groupId: group.id,
      groupName: group.name,
    },
    ...members.map(member => ({
      id: `student:${org.id}:${group.id}:${normalizeCommandCenterEmail(member.email) || member.name}`,
      type: 'student' as const,
      label: member.name || member.email || 'Student',
      detail: `${member.email || 'No email'} - ${group.name}`,
      orgId: org.id,
      orgName: org.name,
      groupId: group.id,
      groupName: group.name,
    })),
  ];
  if (sponsor) {
    searchEntries.push({
      id: `teacher:${org.id}:${group.id}:${normalizeCommandCenterEmail(sponsor.email) || sponsor.name}`,
      type: 'teacher',
      label: sponsor.name,
      detail: `${sponsor.email || 'No email'} - ${group.name}`,
      orgId: org.id,
      orgName: org.name,
      groupId: group.id,
      groupName: group.name,
    });
  }

  return {
    groupId: group.id,
    groupName: group.name,
    sponsor,
    memberCount: uniqueEmailCount(members),
    lastActivityDate: toIsoOrNull(latestActivity),
    lastMeetingDate: toIsoOrNull(latestMeeting),
    status,
    statusLabel,
    compliant,
    resourceHours,
    members,
    events,
    announcements,
    forms,
    pointEntries,
    activityTimestamps,
    alerts,
    searchEntries,
    tasksAutomated,
  };
};

export const buildOrgDashboardPayload = ({
  org,
  groups,
  assistantLogs,
  now = new Date(),
}: {
  org: RawOrgInput;
  groups: RawGroupInput[];
  assistantLogs: AssistantActionLogInput[];
  now?: Date;
}): OrgDashboardPayload => {
  const recentWeekThreshold = now.getTime() - SEVEN_DAYS_MS;
  const groupAnalytics = groups.map(group => buildGroupAnalytics({ org, group, logs: assistantLogs, now }));
  const activeMemberEmails = new Set<string>();
  groupAnalytics.forEach(group => {
    group.members.forEach(member => {
      const email = normalizeCommandCenterEmail(member.email);
      if (email) activeMemberEmails.add(email);
    });
  });
  const weeklyMeetingDensity = groupAnalytics.reduce(
    (sum, group) => sum + group.events.filter(event => getEventTimestamp(event) >= recentWeekThreshold).length,
    0
  );
  const totalStudentBody = Number(org.usageEstimateMembers ?? 0);
  const compliantGroups = groupAnalytics.filter(group => group.compliant).length;
  const compliancePercent = groupAnalytics.length > 0 ? Math.round((compliantGroups / groupAnalytics.length) * 100) : null;
  const engagementPercent =
    totalStudentBody > 0 ? Math.round((activeMemberEmails.size / totalStudentBody) * 100) : null;
  const tasksAutomated = groupAnalytics.reduce((sum, group) => sum + group.tasksAutomated, 0);
  const auditLog = groupAnalytics
    .flatMap(group => group.alerts)
    .sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp))
    .slice(0, 16);
  const dashboardGroups = groupAnalytics
    .map(group => ({
      groupId: group.groupId,
      groupName: group.groupName,
      sponsor: group.sponsor,
      memberCount: group.memberCount,
      lastActivityDate: group.lastActivityDate,
      lastMeetingDate: group.lastMeetingDate,
      status: group.status,
      statusLabel: group.statusLabel,
      compliant: group.compliant,
      resourceHours: group.resourceHours,
    }))
    .sort((left, right) => left.groupName.localeCompare(right.groupName));

  return {
    org: {
      id: org.id,
      name: org.name,
      totalStudentBody,
    },
    kpis: {
      totalActiveMembers: activeMemberEmails.size,
      weeklyMeetingDensity,
      engagementPercent,
      compliancePercent,
      tasksAutomated,
    },
    groups: dashboardGroups,
    auditLog,
    heatmap: buildHeatmap(groups),
    exportRows: dashboardGroups.map(group => ({
      orgName: org.name,
      groupName: group.groupName,
      activeMembers: group.memberCount,
      sponsor: group.sponsor ? `${group.sponsor.name}${group.sponsor.email ? ` <${group.sponsor.email}>` : ''}` : '',
      lastActivityDate: group.lastActivityDate ? compactDate(toTimestamp(group.lastActivityDate)) : '',
      status: group.statusLabel,
      compliant: group.compliant ? 'Yes' : 'No',
      resourceHours: group.resourceHours,
      tasksAutomated: groupAnalytics.find(item => item.groupId === group.groupId)?.tasksAutomated ?? 0,
    })),
  };
};

export const buildExecutiveDashboardPayload = ({
  orgs,
  groupsByOrgId,
  assistantLogs,
  now = new Date(),
}: {
  orgs: RawOrgInput[];
  groupsByOrgId: Record<string, RawGroupInput[]>;
  assistantLogs: AssistantActionLogInput[];
  now?: Date;
}): ExecutiveDashboardPayload => {
  const orgPayloads = orgs.map(org =>
    buildOrgDashboardPayload({
      org,
      groups: groupsByOrgId[org.id] ?? [],
      assistantLogs: assistantLogs.filter(log => log.org_id === org.id),
      now,
    })
  );
  const totalMemberEmails = new Set<string>();
  orgs.forEach(org => {
    (groupsByOrgId[org.id] ?? []).forEach(group => {
      const state = (group.state ?? {}) as Record<string, unknown>;
      asArray<Member>(state.members).forEach(member => {
        const email = normalizeCommandCenterEmail(member.email);
        if (email) totalMemberEmails.add(email);
      });
    });
  });
  const allGroups = orgPayloads.flatMap(payload => payload.groups);
  const districtCompliancePercent =
    allGroups.length > 0
      ? Math.round((allGroups.filter(group => group.compliant).length / allGroups.length) * 100)
      : null;
  const campuses = orgPayloads.map(payload => {
    const timestamps = (groupsByOrgId[payload.org.id] ?? []).flatMap(group => collectActivityTimestamps(group.state));
    return {
      orgId: payload.org.id,
      orgName: payload.org.name,
      totalGroups: payload.groups.length,
      engagementPercent: payload.kpis.engagementPercent,
      impactedStudents: payload.kpis.totalActiveMembers,
      compliancePercent: payload.kpis.compliancePercent,
      resourceHours: payload.groups.reduce((sum, group) => sum + group.resourceHours, 0),
      tasksAutomated: payload.kpis.tasksAutomated,
      healthSparkline: buildSparkline(timestamps, now),
    };
  });
  const searchIndex = orgs
    .flatMap(org =>
      (groupsByOrgId[org.id] ?? []).flatMap(group =>
        buildGroupAnalytics({
          org,
          group,
          logs: assistantLogs.filter(log => log.org_id === org.id),
          now,
        }).searchEntries
      )
    )
    .filter((entry, index, entries) => entries.findIndex(candidate => candidate.id === entry.id) === index)
    .slice(0, 500);

  return {
    ownedOrgCount: orgs.length,
    kpis: {
      totalImpactedStudents: totalMemberEmails.size,
      districtCompliancePercent,
      totalResourceHours: campuses.reduce((sum, campus) => sum + campus.resourceHours, 0),
      tasksAutomated: campuses.reduce((sum, campus) => sum + campus.tasksAutomated, 0),
    },
    campuses,
    systemAlerts: orgPayloads
      .flatMap(payload => payload.auditLog)
      .sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp))
      .slice(0, 20),
    searchIndex,
    exportRows: orgPayloads.flatMap(payload => payload.exportRows),
  };
};

const escapeCsvValue = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const buildEngagementReportCsv = (rows: EngagementReportRow[]) => {
  const headers: Array<keyof EngagementReportRow> = [
    'orgName',
    'groupName',
    'activeMembers',
    'sponsor',
    'lastActivityDate',
    'status',
    'compliant',
    'resourceHours',
    'tasksAutomated',
  ];
  return [
    headers.map(escapeCsvValue).join(','),
    ...rows.map(row => headers.map(header => escapeCsvValue(row[header])).join(',')),
  ].join('\n');
};
