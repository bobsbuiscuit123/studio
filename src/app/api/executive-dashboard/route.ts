import { NextResponse } from 'next/server';

import {
  buildEngagementReportCsv,
  buildExecutiveDashboardPayload,
  type AssistantActionLogInput,
  type RawGroupInput,
  type RawOrgInput,
} from '@/lib/command-center-analytics';
import { buildEngagementReportPdf } from '@/lib/command-center-report-pdf';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { rateLimit } from '@/lib/rate-limit';
import { err } from '@/lib/result';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { stripHeavyMediaFromOrgState } from '@/lib/org-state-media';

export const dynamic = 'force-dynamic';

const DASHBOARD_STATE_SELECT = [
  'org_id',
  'group_id',
  'members:data->members',
  'events:data->events',
  'announcements:data->announcements',
  'forms:data->forms',
  'pointEntries:data->pointEntries',
  'galleryImages:data->galleryImages',
  'socialPosts:data->socialPosts',
].join(', ');

const buildLiteDashboardState = (row: Record<string, unknown>) =>
  stripHeavyMediaFromOrgState({
    members: Array.isArray(row.members) ? row.members : [],
    events: Array.isArray(row.events) ? row.events : [],
    announcements: Array.isArray(row.announcements) ? row.announcements : [],
    forms: Array.isArray(row.forms) ? row.forms : [],
    pointEntries: Array.isArray(row.pointEntries) ? row.pointEntries : [],
    galleryImages: Array.isArray(row.galleryImages) ? row.galleryImages : [],
    socialPosts: Array.isArray(row.socialPosts) ? row.socialPosts : [],
  }) as Record<string, unknown>;

const csvAttachmentResponse = (csv: string, filename: string) =>
  new Response(`\uFEFF${csv}`, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'text/csv; charset=utf-8',
    },
  });

const pdfAttachmentResponse = (pdf: Uint8Array, filename: string) =>
  new Response(pdf, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'application/pdf',
    },
  });

const loadAssistantLogs = async ({
  admin,
  orgIds,
}: {
  admin: ReturnType<typeof createSupabaseAdmin>;
  orgIds: string[];
}): Promise<AssistantActionLogInput[]> => {
  if (orgIds.length === 0) return [];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('assistant_action_logs')
    .select('id, org_id, group_id, action_type, result, error_message, created_at')
    .in('org_id', orgIds)
    .gte('created_at', since);

  if (error) {
    console.error('[executive-dashboard] assistant logs unavailable', error);
    return [];
  }

  return data ?? [];
};

export async function GET(request: Request) {
  const ipLimiter = rateLimit(`executive-dashboard:${getRequestIp(request.headers)}`, 60, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  if (format && format !== 'csv' && format !== 'pdf') {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid report format.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`executive-dashboard-user:${userId}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  const [{ data: ownerMembershipRows, error: ownerMembershipError }, { data: ownerOrgRows, error: ownerOrgError }] =
    await Promise.all([
      admin
        .from('memberships')
        .select('org_id, orgs ( id, name, usage_estimate_members, owner_id )')
        .eq('user_id', userId)
        .eq('role', 'owner'),
      admin
        .from('orgs')
        .select('id, name, usage_estimate_members, owner_id')
        .eq('owner_id', userId),
    ]);

  if (ownerMembershipError || ownerOrgError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: ownerMembershipError?.message || ownerOrgError?.message || 'Unable to load owned organizations.',
        source: 'network',
      }),
      { status: 500 }
    );
  }

  const orgById = new Map<string, RawOrgInput>();
  (ownerMembershipRows ?? []).forEach((row: any) => {
    const orgRecord = Array.isArray(row.orgs) ? row.orgs[0] : row.orgs;
    const id = typeof orgRecord?.id === 'string' ? orgRecord.id : row.org_id;
    if (!id) return;
    orgById.set(id, {
      id,
      name: orgRecord?.name || 'Organization',
      usageEstimateMembers: Number(orgRecord?.usage_estimate_members ?? 0),
    });
  });
  (ownerOrgRows ?? []).forEach(row => {
    if (!row.id) return;
    orgById.set(row.id, {
      id: row.id,
      name: row.name || 'Organization',
      usageEstimateMembers: Number(row.usage_estimate_members ?? 0),
    });
  });

  const orgs = Array.from(orgById.values()).sort((left, right) => left.name.localeCompare(right.name));
  if (orgs.length === 0) {
    const payload = buildExecutiveDashboardPayload({
      orgs: [],
      groupsByOrgId: {},
      assistantLogs: [],
    });
    if (format === 'pdf') {
      return pdfAttachmentResponse(
        buildEngagementReportPdf(payload.exportRows, {
          title: 'Caspo Executive Engagement Report',
          subtitle: 'Executive Command Center',
          summary: [
            'Owned Organizations: 0',
            'Total Impacted Students: 0',
            'District-Wide Compliance: --',
            'Total Resource Hours: 0',
            'Tasks Automated: 0',
          ],
        }),
        'caspo-engagement-report.pdf'
      );
    }
    if (format === 'csv') {
      return csvAttachmentResponse(buildEngagementReportCsv(payload.exportRows), 'caspo-engagement-report.csv');
    }
    return NextResponse.json({
      ok: true,
      data: payload,
    });
  }

  const orgIds = orgs.map(org => org.id);
  const [{ data: groupRows, error: groupError }, { data: stateRows, error: stateError }, assistantLogs] =
    await Promise.all([
      admin
        .from('groups')
        .select('id, org_id, name')
        .in('org_id', orgIds)
        .order('created_at', { ascending: true }),
      admin
        .from('group_state')
        .select(DASHBOARD_STATE_SELECT)
        .in('org_id', orgIds),
      loadAssistantLogs({ admin, orgIds }),
    ]);

  if (groupError || stateError) {
    return NextResponse.json(
      err({
        code: 'NETWORK_HTTP_ERROR',
        message: groupError?.message || stateError?.message || 'Unable to load groups.',
        source: 'network',
      }),
      { status: 500 }
    );
  }

  const stateByGroupId = new Map<string, Record<string, unknown>>();
  (stateRows ?? []).forEach(row => {
    if (typeof row.group_id === 'string') {
      stateByGroupId.set(row.group_id, buildLiteDashboardState(row as Record<string, unknown>));
    }
  });

  const groupsByOrgId = (groupRows ?? []).reduce<Record<string, RawGroupInput[]>>((acc, group) => {
    const orgId = typeof group.org_id === 'string' ? group.org_id : '';
    if (!orgId) return acc;
    acc[orgId] = acc[orgId] ?? [];
    acc[orgId].push({
      id: group.id,
      name: group.name || 'Group',
      state: stateByGroupId.get(group.id) ?? {},
    });
    return acc;
  }, {});

  const payload = buildExecutiveDashboardPayload({
    orgs,
    groupsByOrgId,
    assistantLogs,
  });

  if (format === 'csv') {
    return csvAttachmentResponse(buildEngagementReportCsv(payload.exportRows), 'caspo-engagement-report.csv');
  }

  if (format === 'pdf') {
    return pdfAttachmentResponse(
      buildEngagementReportPdf(payload.exportRows, {
        title: 'Caspo Executive Engagement Report',
        subtitle: `${payload.ownedOrgCount.toLocaleString()} owned organization${payload.ownedOrgCount === 1 ? '' : 's'}`,
        summary: [
          `Total Impacted Students: ${payload.kpis.totalImpactedStudents.toLocaleString()}`,
          `District-Wide Compliance: ${typeof payload.kpis.districtCompliancePercent === 'number' ? `${payload.kpis.districtCompliancePercent}%` : '--'}`,
          `Total Resource Hours: ${payload.kpis.totalResourceHours.toLocaleString()}`,
          `Tasks Automated: ${payload.kpis.tasksAutomated.toLocaleString()}`,
        ],
      }),
      'caspo-engagement-report.pdf'
    );
  }

  return NextResponse.json({
    ok: true,
    data: payload,
  });
}
