'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getOfficerMetrics } from '@/lib/analytics/officerMetrics';
import { useAnnouncements, useEvents, useTransactions } from '@/lib/data-hooks';

const emptyFallback = 'Not enough data yet.';

export default function OfficerCharts({ clubId: _clubId }: { clubId?: string | null }) {
  const announcements = useAnnouncements();
  const events = useEvents();
  const transactions = useTransactions();

  const loading = announcements.loading || events.loading || transactions.loading;

  const metrics = useMemo(
    () =>
      getOfficerMetrics({
        announcements: announcements.data,
        events: events.data,
        transactions: transactions.data,
      }),
    [announcements.data, events.data, transactions.data]
  );

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Engagement over time</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {metrics.engagementSeries.length === 0 ? (
            <div className="text-sm text-muted-foreground">{emptyFallback}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.engagementSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="views" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">RSVP rate by event</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {metrics.rsvpSeries.length === 0 ? (
            <div className="text-sm text-muted-foreground">{emptyFallback}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.rsvpSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="event" interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} unit="%" />
                <Tooltip formatter={(value: number) => [`${value}%`, 'RSVP Rate']} />
                <Bar dataKey="rsvpRate" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Finances snapshot</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {metrics.financeSeries.length === 0 ? (
            <div className="text-sm text-muted-foreground">{emptyFallback}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.financeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} />
                <Line type="monotone" dataKey="expenses" stroke="#f97316" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
