import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { err } from '@/lib/result';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';
import { canEditGroupContent } from '@/lib/group-permissions';
import {
  GROUP_GALLERIES_BUCKET,
  buildStoredImagePath,
  getStorageObjectPathFromPublicUrl,
  isStoredImageScope,
  sanitizeStorageFilename,
  type StoredImageScope,
} from '@/lib/storage-image-paths';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

const deleteSchema = z
  .object({
    bucket: z.literal(GROUP_GALLERIES_BUCKET).optional(),
    path: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    orgId: z.string().uuid(),
    groupId: z.string().uuid().nullable().optional(),
    scope: z.enum(['gallery', 'avatar', 'group-logo', 'org-logo']),
  })
  .strict();

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

const getRequestIp = async () => {
  const headerList = await headers();
  return (
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown'
  );
};

const jsonError = (
  message: string,
  status: number,
  limiter: ReturnType<typeof rateLimit>,
  code: 'VALIDATION' | 'NETWORK_HTTP_ERROR' = 'VALIDATION'
) =>
  NextResponse.json(
    err({
      code,
      message,
      source: code === 'NETWORK_HTTP_ERROR' ? 'network' : 'app',
    }),
    {
      status,
      headers: {
        ...noStoreHeaders,
        ...getRateLimitHeaders(limiter),
      },
    }
  );

const isUploadFile = (value: FormDataEntryValue | null): value is File =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'arrayBuffer' in value &&
      'size' in value &&
      'type' in value
  );

const loadOrgAccess = async (admin: SupabaseAdmin, orgId: string, userId: string) => {
  const [{ data: membership, error: membershipError }, { data: org, error: orgError }] =
    await Promise.all([
      admin
        .from('memberships')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('orgs')
        .select('owner_id')
        .eq('id', orgId)
        .maybeSingle(),
    ]);

  if (membershipError) throw membershipError;
  if (orgError) throw orgError;

  const role = typeof membership?.role === 'string' ? membership.role : null;
  return {
    isMember: Boolean(membership),
    isOwner: role === 'owner' || org?.owner_id === userId,
    role,
  };
};

const groupExists = async (admin: SupabaseAdmin, orgId: string, groupId: string) => {
  const { data, error } = await admin
    .from('groups')
    .select('id')
    .eq('org_id', orgId)
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
};

const requireStorageAccess = async ({
  admin,
  userId,
  orgId,
  groupId,
  scope,
  action,
}: {
  admin: SupabaseAdmin;
  userId: string;
  orgId: string;
  groupId?: string | null;
  scope: StoredImageScope;
  action: 'upload' | 'delete';
}) => {
  const orgAccess = await loadOrgAccess(admin, orgId, userId);
  if (!orgAccess.isMember) {
    return false;
  }

  if (scope === 'avatar') {
    return true;
  }

  if (scope === 'org-logo') {
    return orgAccess.isOwner;
  }

  if (!groupId) {
    return false;
  }

  if (scope === 'group-logo') {
    const exists = await groupExists(admin, orgId, groupId);
    if (!exists) {
      return true;
    }
    const access = await ensureOrgOwnerGroupMembership({ admin, orgId, groupId, userId });
    return access.ok && (access.isOrgOwner || access.role === 'admin');
  }

  const access = await ensureOrgOwnerGroupMembership({ admin, orgId, groupId, userId });
  if (!access.ok) {
    return false;
  }

  return action === 'upload' || canEditGroupContent(access.role);
};

const validateObjectPathScope = ({
  path,
  orgId,
  groupId,
  scope,
  userId,
}: {
  path: string;
  orgId: string;
  groupId?: string | null;
  scope: StoredImageScope;
  userId?: string | null;
}) => {
  if (!path.startsWith(`${orgId}/`)) {
    return false;
  }

  if ((scope === 'gallery' || scope === 'group-logo') && groupId) {
    return path.startsWith(`${orgId}/${groupId}/`);
  }

  if (scope === 'avatar') {
    return Boolean(userId) && path.startsWith(`${orgId}/profiles/${userId}/`);
  }

  if (scope === 'org-logo') {
    return path.startsWith(`${orgId}/org-logo/`);
  }

  return true;
};

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`storage-image-upload:${await getRequestIp()}`, 60, 60_000);
  if (!ipLimiter.allowed) {
    return jsonError('Too many image uploads. Please slow down.', 429, ipLimiter, 'NETWORK_HTTP_ERROR');
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return jsonError('Unauthorized.', 401, ipLimiter);
  }

  const userLimiter = rateLimit(`storage-image-upload-user:${userId}`, 40, 60_000);
  if (!userLimiter.allowed) {
    return jsonError('Too many image uploads. Please slow down.', 429, userLimiter, 'NETWORK_HTTP_ERROR');
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return jsonError('Invalid upload payload.', 400, userLimiter);
  }

  const orgId = String(formData.get('orgId') ?? '').trim();
  const groupId = String(formData.get('groupId') ?? '').trim() || null;
  const scopeValue = String(formData.get('scope') ?? '').trim();
  const fileNameValue = String(formData.get('fileName') ?? '').trim();
  const file = formData.get('file');

  if (!z.string().uuid().safeParse(orgId).success) {
    return jsonError('Invalid organization id.', 400, userLimiter);
  }
  if (groupId && !z.string().uuid().safeParse(groupId).success) {
    return jsonError('Invalid group id.', 400, userLimiter);
  }
  if (!isStoredImageScope(scopeValue)) {
    return jsonError('Invalid image upload scope.', 400, userLimiter);
  }
  if (!isUploadFile(file)) {
    return jsonError('Missing image file.', 400, userLimiter);
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return jsonError('Unsupported image type.', 400, userLimiter);
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return jsonError('Image must be smaller than 5 MB.', 400, userLimiter);
  }

  const admin = createSupabaseAdmin();
  try {
    const allowed = await requireStorageAccess({
      admin,
      userId,
      orgId,
      groupId,
      scope: scopeValue,
      action: 'upload',
    });
    if (!allowed) {
      return jsonError('Access denied.', 403, userLimiter);
    }

    const safeFileName = sanitizeStorageFilename(fileNameValue || file.name || 'image', file.type);
    const path = buildStoredImagePath({
      orgId,
      groupId,
      scope: scopeValue,
      userId,
      fileName: safeFileName,
    });
    const { error: uploadError } = await admin.storage
      .from(GROUP_GALLERIES_BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return jsonError(uploadError.message, 500, userLimiter, 'NETWORK_HTTP_ERROR');
    }

    const { data } = admin.storage.from(GROUP_GALLERIES_BUCKET).getPublicUrl(path);
    return NextResponse.json(
      {
        ok: true,
        data: {
          bucket: GROUP_GALLERIES_BUCKET,
          path,
          url: data.publicUrl,
        },
      },
      {
        headers: {
          ...noStoreHeaders,
          ...getRateLimitHeaders(userLimiter),
        },
      }
    );
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Image upload failed.',
      500,
      userLimiter,
      'NETWORK_HTTP_ERROR'
    );
  }
}

export async function DELETE(request: Request) {
  const ipLimiter = rateLimit(`storage-image-delete:${await getRequestIp()}`, 120, 60_000);
  if (!ipLimiter.allowed) {
    return jsonError('Too many image delete requests. Please slow down.', 429, ipLimiter, 'NETWORK_HTTP_ERROR');
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return jsonError('Unauthorized.', 401, ipLimiter);
  }

  const userLimiter = rateLimit(`storage-image-delete-user:${userId}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return jsonError('Too many image delete requests. Please slow down.', 429, userLimiter, 'NETWORK_HTTP_ERROR');
  }

  const body = await request.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Invalid image delete payload.', 400, userLimiter);
  }

  const objectPath =
    parsed.data.path || (parsed.data.url ? getStorageObjectPathFromPublicUrl(parsed.data.url) : null);
  if (!objectPath) {
    return NextResponse.json(
      { ok: true, data: { deleted: false } },
      {
        headers: {
          ...noStoreHeaders,
          ...getRateLimitHeaders(userLimiter),
        },
      }
    );
  }

  if (
    !validateObjectPathScope({
      path: objectPath,
        orgId: parsed.data.orgId,
        groupId: parsed.data.groupId,
        scope: parsed.data.scope,
        userId,
      })
  ) {
    return jsonError('Image path does not belong to this organization.', 403, userLimiter);
  }

  const admin = createSupabaseAdmin();
  try {
    const allowed = await requireStorageAccess({
      admin,
      userId,
      orgId: parsed.data.orgId,
      groupId: parsed.data.groupId,
      scope: parsed.data.scope,
      action: 'delete',
    });
    if (!allowed) {
      return jsonError('Access denied.', 403, userLimiter);
    }

    const { error: deleteError } = await admin.storage
      .from(GROUP_GALLERIES_BUCKET)
      .remove([objectPath]);
    if (deleteError) {
      return jsonError(deleteError.message, 500, userLimiter, 'NETWORK_HTTP_ERROR');
    }

    return NextResponse.json(
      { ok: true, data: { deleted: true } },
      {
        headers: {
          ...noStoreHeaders,
          ...getRateLimitHeaders(userLimiter),
        },
      }
    );
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Image delete failed.',
      500,
      userLimiter,
      'NETWORK_HTTP_ERROR'
    );
  }
}
