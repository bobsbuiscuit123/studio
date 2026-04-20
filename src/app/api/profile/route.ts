import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createDashboardLogger,
  createDashboardRequestId,
  DASHBOARD_TIMEOUT_MS,
  withTimeout,
} from '@/lib/dashboard-load';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { err } from '@/lib/result';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { getAuthMetadataDisplayName, resolveStoredDisplayName } from '@/lib/user-display-name';

const avatarSchema = z.string().trim().max(2_000_000).refine(
  (value) => value.length === 0 || value.startsWith('data:image/') || /^https?:\/\//.test(value),
  'Invalid avatar.'
);
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const apiLogger = createDashboardLogger('[Dashboard][API]');

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatar: avatarSchema.optional(),
}).strict();

const getRequestId = (request: Request) =>
  request.headers.get('x-request-id') || createDashboardRequestId('profile');

const getErrorStatus = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 504 : 500;

const getErrorCode = (error: unknown) =>
  error instanceof Error && error.name === 'TimeoutError' ? 'NETWORK_TIMEOUT' : 'NETWORK_HTTP_ERROR';

const syncGroupStateMemberProfiles = async ({
  userId,
  userEmail,
  displayName,
  avatarUrl,
}: {
  userId: string;
  userEmail?: string | null;
  displayName: string;
  avatarUrl: string;
}) => {
  const admin = createSupabaseAdmin();
  const normalizedUserEmail = userEmail ? normalizeEmail(userEmail) : '';

  const { data: memberships, error: membershipsError } = await admin
    .from('group_memberships')
    .select('org_id, group_id')
    .eq('user_id', userId);

  if (membershipsError) {
    throw membershipsError;
  }

  for (const membership of memberships ?? []) {
    const orgId = typeof membership.org_id === 'string' ? membership.org_id : '';
    const groupId = typeof membership.group_id === 'string' ? membership.group_id : '';
    if (!orgId || !groupId) {
      continue;
    }

    const { data: stateRow, error: stateError } = await admin
      .from('group_state')
      .select('data')
      .eq('org_id', orgId)
      .eq('group_id', groupId)
      .maybeSingle();

    if (stateError) {
      throw stateError;
    }

    const currentData =
      stateRow?.data && typeof stateRow.data === 'object'
        ? (stateRow.data as Record<string, unknown>)
        : null;
    const currentMembers = Array.isArray(currentData?.members) ? currentData.members : [];
    let changed = false;

    const nextMembers = currentMembers.map((member) => {
      if (!member || typeof member !== 'object') {
        return member;
      }

      const currentMember = member as Record<string, unknown>;
      const memberId = typeof currentMember.id === 'string' ? currentMember.id : '';
      const memberEmail =
        typeof currentMember.email === 'string' ? normalizeEmail(currentMember.email) : '';
      const matchesMember =
        memberId === userId || (normalizedUserEmail.length > 0 && memberEmail === normalizedUserEmail);

      if (!matchesMember) {
        return member;
      }

      changed = true;
      return {
        ...currentMember,
        id: userId,
        email: normalizedUserEmail || currentMember.email,
        name: displayName,
        avatar: avatarUrl,
      };
    });

    if (!changed || !currentData) {
      continue;
    }

    const { error: updateError } = await admin
      .from('group_state')
      .update({ data: { ...currentData, members: nextMembers } })
      .eq('org_id', orgId)
      .eq('group_id', groupId);

    if (updateError) {
      throw updateError;
    }
  }
};

export async function PATCH(request: Request) {
  const ipLimiter = rateLimit(`profile-patch:${getRequestIp(request.headers)}`, 30, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid profile payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
      { status: 401 }
    );
  }

  const userLimiter = rateLimit(`profile-patch-user:${user.id}`, 30, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  if (existingProfileError) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: existingProfileError.message, source: 'network' }),
      { status: 500 }
    );
  }

  const displayName = resolveStoredDisplayName({
    preferredName: parsed.data.name,
    existingProfileName: existingProfile?.display_name,
    authDisplayName: getAuthMetadataDisplayName(user),
    email: user.email,
  });

  const requestedAvatar =
    typeof parsed.data.avatar === 'string' && parsed.data.avatar.trim().length > 0
      ? parsed.data.avatar.trim()
      : null;
  const existingAvatar =
    typeof existingProfile?.avatar_url === 'string' && existingProfile.avatar_url.trim().length > 0
      ? existingProfile.avatar_url
      : null;
  const avatarUrl =
    requestedAvatar ||
    existingAvatar ||
    getPlaceholderImageUrl({ label: displayName.charAt(0) });

  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email ? normalizeEmail(user.email) : null,
    display_name: displayName,
    avatar_url: avatarUrl,
  });
  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  try {
    await syncGroupStateMemberProfiles({
      userId: user.id,
      userEmail: user.email,
      displayName,
      avatarUrl,
    });
  } catch (syncError) {
    console.error('Failed to sync group member profile snapshots', syncError);
  }

  return NextResponse.json({
    ok: true,
    data: {
      name: displayName,
      email: user.email ? normalizeEmail(user.email) : '',
      avatar: avatarUrl,
    },
  });
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const ipLimiter = rateLimit(`profile-get:${getRequestIp(request.headers)}`, 60, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  apiLogger.log('Profile load start', { requestId });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await withTimeout(
      () => supabase.auth.getUser(),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Profile auth lookup' }
    );
    const user = userData.user;

    if (!user) {
      apiLogger.log('Profile load success', {
        requestId,
        status: 'empty',
      });
      return NextResponse.json({ ok: true, data: null });
    }

    const userLimiter = rateLimit(`profile-get-user:${user.id}`, 120, 60_000);
    if (!userLimiter.allowed) {
      return rateLimitExceededResponse(userLimiter);
    }

    const { data: profile, error: profileError } = await withTimeout(
      () =>
        supabase
          .from('profiles')
          .select('email, display_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle(),
      DASHBOARD_TIMEOUT_MS,
      { label: 'Profile row lookup' }
    );

    if (profileError) {
      apiLogger.error('Profile load failed', profileError, {
        requestId,
        stage: 'profile-query',
        userId: user.id,
      });
      return NextResponse.json(
        err({ code: 'NETWORK_HTTP_ERROR', message: profileError.message, source: 'network' }),
        { status: 500 }
      );
    }

    const displayName = resolveStoredDisplayName({
      existingProfileName: profile?.display_name,
      authDisplayName: getAuthMetadataDisplayName(user),
      email: profile?.email || user.email || '',
    });

    const payload = {
      name: displayName,
      email: profile?.email || (user.email ? normalizeEmail(user.email) : ''),
      avatar: getPlaceholderImageUrl({ label: displayName.charAt(0) || 'U' }),
    };

    if (profile?.avatar_url && profile.avatar_url.trim()) {
      payload.avatar = profile.avatar_url;
    }

    apiLogger.log('Profile load success', {
      requestId,
      status: 'success',
      userId: user.id,
      hasProfileRow: Boolean(profile),
    });

    return NextResponse.json({ ok: true, data: payload });
  } catch (error) {
    apiLogger.error('Profile load failed', error, { requestId });
    return NextResponse.json(
      err({
        code: getErrorCode(error),
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Profile could not be loaded.',
        source: 'network',
      }),
      { status: getErrorStatus(error) }
    );
  }
}
