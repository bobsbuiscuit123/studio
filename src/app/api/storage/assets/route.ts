import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import { ensureOrgOwnerGroupMembership } from '@/lib/group-access';
import { canEditGroupContent } from '@/lib/group-permissions';
import {
  GROUP_ASSETS_BUCKET,
  buildGroupAssetPath,
  getGroupAssetObjectPathFromPublicUrl,
  isGroupAssetScope,
  sanitizeGroupAssetFilename,
  type GroupAssetScope,
} from '@/lib/group-assets-paths';
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { err } from '@/lib/result';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_ASSET_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
]);

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

const deleteSchema = z
  .object({
    bucket: z.literal(GROUP_ASSETS_BUCKET).optional(),
    path: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    orgId: z.string().uuid(),
    groupId: z.string().uuid(),
  })
  .strict();

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

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

const requireAssetAccess = async ({
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
  groupId: string;
  scope: GroupAssetScope;
  action: 'upload' | 'delete';
}) => {
  const access = await ensureOrgOwnerGroupMembership({ admin, orgId, groupId, userId });
  if (!access.ok) return false;
  if (access.isOrgOwner || canEditGroupContent(access.role)) return true;
  return action === 'upload' && scope === 'form-response';
};

const validateObjectPathScope = ({
  path,
  orgId,
  groupId,
}: {
  path: string;
  orgId: string;
  groupId: string;
}) => path.startsWith(`${orgId}/${groupId}/`);

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`storage-asset-upload:${getRequestIp(request.headers)}`, 80, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return jsonError('Unauthorized.', 401, ipLimiter);
  }

  const userLimiter = rateLimit(`storage-asset-upload-user:${userId}`, 60, 60_000);
  if (!userLimiter.allowed) {
    return jsonError('Too many asset uploads. Please slow down.', 429, userLimiter, 'NETWORK_HTTP_ERROR');
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return jsonError('Invalid upload payload.', 400, userLimiter);
  }

  const orgId = String(formData.get('orgId') ?? '').trim();
  const groupId = String(formData.get('groupId') ?? '').trim();
  const scopeValue = String(formData.get('scope') ?? '').trim();
  const fileNameValue = String(formData.get('fileName') ?? '').trim();
  const file = formData.get('file');

  if (!z.string().uuid().safeParse(orgId).success) {
    return jsonError('Invalid organization id.', 400, userLimiter);
  }
  if (!z.string().uuid().safeParse(groupId).success) {
    return jsonError('Invalid group id.', 400, userLimiter);
  }
  if (!isGroupAssetScope(scopeValue)) {
    return jsonError('Invalid asset upload scope.', 400, userLimiter);
  }
  if (!isUploadFile(file)) {
    return jsonError('Missing asset file.', 400, userLimiter);
  }
  if (!ALLOWED_ASSET_TYPES.has(file.type)) {
    return jsonError('Unsupported asset type.', 400, userLimiter);
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return jsonError('Asset must be smaller than 10 MB.', 400, userLimiter);
  }

  const admin = createSupabaseAdmin();
  try {
    const allowed = await requireAssetAccess({
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

    const safeFileName = sanitizeGroupAssetFilename(fileNameValue || file.name || 'asset', file.type);
    const path = buildGroupAssetPath({ orgId, groupId, fileName: safeFileName });
    const { error: uploadError } = await admin.storage
      .from(GROUP_ASSETS_BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return jsonError(uploadError.message, 500, userLimiter, 'NETWORK_HTTP_ERROR');
    }

    const { data } = admin.storage.from(GROUP_ASSETS_BUCKET).getPublicUrl(path);
    return NextResponse.json(
      {
        ok: true,
        data: {
          bucket: GROUP_ASSETS_BUCKET,
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
      error instanceof Error ? error.message : 'Asset upload failed.',
      500,
      userLimiter,
      'NETWORK_HTTP_ERROR'
    );
  }
}

export async function DELETE(request: Request) {
  const ipLimiter = rateLimit(`storage-asset-delete:${getRequestIp(request.headers)}`, 120, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return jsonError('Unauthorized.', 401, ipLimiter);
  }

  const userLimiter = rateLimit(`storage-asset-delete-user:${userId}`, 120, 60_000);
  if (!userLimiter.allowed) {
    return jsonError('Too many asset delete requests. Please slow down.', 429, userLimiter, 'NETWORK_HTTP_ERROR');
  }

  const body = await request.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Invalid asset delete payload.', 400, userLimiter);
  }

  const objectPath =
    parsed.data.path || (parsed.data.url ? getGroupAssetObjectPathFromPublicUrl(parsed.data.url) : null);
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

  if (!validateObjectPathScope({ path: objectPath, orgId: parsed.data.orgId, groupId: parsed.data.groupId })) {
    return jsonError('Asset path does not belong to this group.', 403, userLimiter);
  }

  const admin = createSupabaseAdmin();
  try {
    const allowed = await requireAssetAccess({
      admin,
      userId,
      orgId: parsed.data.orgId,
      groupId: parsed.data.groupId,
      scope: 'announcement',
      action: 'delete',
    });
    if (!allowed) {
      return jsonError('Access denied.', 403, userLimiter);
    }

    const { error: deleteError } = await admin.storage
      .from(GROUP_ASSETS_BUCKET)
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
      error instanceof Error ? error.message : 'Asset delete failed.',
      500,
      userLimiter,
      'NETWORK_HTTP_ERROR'
    );
  }
}
