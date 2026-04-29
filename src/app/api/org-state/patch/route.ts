import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { canEditGroupContent, normalizeGroupRole } from '@/lib/group-permissions';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';
import { findPolicyViolation, policyErrorMessage } from '@/lib/content-policy';
import { rateLimit } from '@/lib/rate-limit';
import { err } from '@/lib/result';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const patchPathSegmentSchema = z.union([
  z.string().trim().min(1).max(64),
  z.number().int().min(0).max(100_000),
]);

const patchSchema = z
  .object({
    path: z.array(patchPathSegmentSchema).min(1).max(12),
    value: z.unknown(),
  })
  .strict();

const requestSchema = z
  .object({
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
    patches: z.array(patchSchema).min(1).max(100),
  })
  .strict();

const memberWritableFields: Record<string, Set<string>> = {
  announcements: new Set(['read', 'viewedBy']),
  events: new Set(['attendanceRecords', 'attendees', 'lastViewedAttendees', 'read', 'rsvps', 'viewedBy']),
  forms: new Set(['responses', 'viewedBy']),
  galleryImages: new Set(['liked', 'likedBy', 'likes', 'read', 'viewedBy']),
  socialPosts: new Set(['comments', 'liked', 'likedBy', 'likes', 'read', 'viewedBy']),
};

const normalizePatchPath = (path: Array<string | number>) => path.map(segment => String(segment));

const canMemberWritePatch = (path: string[]) => {
  const [collection, index, field] = path;
  if (!collection || !index || !field) return false;
  return memberWritableFields[collection]?.has(field) ?? false;
};

export async function PATCH(request: Request) {
  const ipLimiter = rateLimit(`org-state-patch:${getRequestIp(request.headers)}`, 180, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid patch payload.', source: 'app' }),
      { status: 400 }
    );
  }

  const violation = findPolicyViolation(parsed.data.patches.map(patch => patch.value));
  if (violation) {
    return NextResponse.json(
      err({
        code: 'VALIDATION',
        message: policyErrorMessage,
        source: 'app',
        detail: `${violation.path}:${violation.match}`,
      }),
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

  const userLimiter = rateLimit(`org-state-patch-user:${userId}`, 240, 60_000);
  if (!userLimiter.allowed) {
    return rateLimitExceededResponse(userLimiter);
  }

  const admin = createSupabaseAdmin();
  const accessResult = await ensureOrgOwnerGroupMembership({
    admin,
    orgId: parsed.data.orgId,
    groupId: parsed.data.groupId,
    userId,
  });
  if (!accessResult.ok) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied.', source: 'app' }),
      { status: 403 }
    );
  }

  const groupRole = normalizeGroupRole(accessResult.role);
  const canEdit = accessResult.isOrgOwner || canEditGroupContent(groupRole);
  const patches = parsed.data.patches.map(patch => ({
    path: normalizePatchPath(patch.path),
    value: patch.value,
  }));

  if (!canEdit && patches.some(patch => !canMemberWritePatch(patch.path))) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Access denied for this patch path.', source: 'app' }),
      { status: 403 }
    );
  }

  const { error } = await supabase.rpc('patch_group_state_many', {
    p_org_id: parsed.data.orgId,
    p_group_id: parsed.data.groupId,
    p_patches: patches,
  });

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data: null });
}
