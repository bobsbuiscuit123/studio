import type { Announcement, ClubEvent, Transaction } from '@/lib/mock-data';

export type EngagementPoint = {
  week: string;
  views: number;
};

export type EventRsvpPoint = {
  event: string;
  rsvpRate: number;
};

export type FinancePoint = {
  month: string;
  income: number;
  expenses: number;
};

export type OfficerMetrics = {
  engagementSeries: EngagementPoint[];
  rsvpSeries: EventRsvpPoint[];
  financeSeries: FinancePoint[];
};

const startOfWeek = (date: Date) => {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const toDate = (value: string | Date | undefined | null) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatWeekLabel = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;

const formatMonthLabel = (date: Date) =>
  `${date.getMonth() + 1}/${date.getFullYear()}`;

const truncateLabel = (label: string, max = 18) =>
  label.length > max ? `${label.slice(0, max - 1)}…` : label;

export const getOfficerMetrics = ({
  announcements = [],
  events = [],
  transactions = [],
}: {
  announcements?: Announcement[];
  events?: ClubEvent[];
  transactions?: Transaction[];
}): OfficerMetrics => {
  const engagementMap = new Map<string, { weekStart: Date; views: number }>();

  announcements.forEach(item => {
    const date = toDate(item.date);
    if (!date) return;
    const weekStart = startOfWeek(date);
    const key = weekStart.toISOString();
    const views = Array.isArray(item.viewedBy) ? item.viewedBy.length : 0;
    const current = engagementMap.get(key);
    if (current) {
      current.views += views;
    } else {
      engagementMap.set(key, {
        weekStart,
        views,
      });
    }
  });

  const engagementSeries = Array.from(engagementMap.values())
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .slice(-8)
    .map(point => ({
      week: formatWeekLabel(point.weekStart),
      views: point.views,
    }));

  const rsvpSeries = [...events]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-6)
    .map(event => {
      const yesCount = Array.isArray(event.rsvps?.yes) ? event.rsvps?.yes.length : 0;
      const maybeCount = Array.isArray(event.rsvps?.maybe)
        ? event.rsvps?.maybe.length
        : 0;
      const noCount = Array.isArray(event.rsvps?.no) ? event.rsvps?.no.length : 0;
      const total = yesCount + maybeCount + noCount;
      const rate = total > 0 ? Math.round((yesCount / total) * 100) : 0;
      return {
        event: truncateLabel(event.title || 'Event'),
        rsvpRate: rate,
      };
    });

  const financeMap = new Map<string, { monthStart: Date; income: number; expenses: number }>();

  transactions.forEach(tx => {
    const date = toDate(tx.date);
    if (!date) return;
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const key = monthStart.toISOString();
    const current = financeMap.get(key) ?? { monthStart, income: 0, expenses: 0 };
    if (tx.amount >= 0) {
      current.income += tx.amount;
    } else {
      current.expenses += Math.abs(tx.amount);
    }
    financeMap.set(key, current);
  });

  const financeSeries = Array.from(financeMap.values())
    .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime())
    .slice(-6)
    .map(point => ({
      month: formatMonthLabel(point.monthStart),
      income: Math.round(point.income),
      expenses: Math.round(point.expenses),
    }));

  return {
    engagementSeries,
    rsvpSeries,
    financeSeries,
  };
};
