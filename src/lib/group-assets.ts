import { safeFetchJson } from '@/lib/network';
import {
  GROUP_ASSETS_BUCKET,
  getGroupAssetObjectPathFromPublicUrl,
  isManagedGroupAssetUrl,
  type GroupAssetScope,
} from '@/lib/group-assets-paths';

type UploadGroupAssetResponse = {
  ok: true;
  data: {
    bucket: string;
    path: string;
    url: string;
  };
};

type DeleteGroupAssetResponse = {
  ok: true;
  data: {
    deleted: boolean;
  };
};

export async function uploadGroupAsset({
  file,
  orgId,
  groupId,
  scope,
  fileName,
}: {
  file: File;
  orgId: string;
  groupId: string;
  scope: GroupAssetScope;
  fileName?: string;
}) {
  const formData = new FormData();
  formData.set('file', file, fileName || file.name);
  formData.set('orgId', orgId);
  formData.set('groupId', groupId);
  formData.set('scope', scope);
  if (fileName) {
    formData.set('fileName', fileName);
  }

  const response = await safeFetchJson<UploadGroupAssetResponse>('/api/storage/assets', {
    method: 'POST',
    body: formData,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.data.data;
}

export async function deleteGroupAsset({
  url,
  orgId,
  groupId,
}: {
  url?: string | null;
  orgId: string;
  groupId: string;
}) {
  if (!url || !isManagedGroupAssetUrl(url)) {
    return { deleted: false };
  }

  const path = getGroupAssetObjectPathFromPublicUrl(url);
  const response = await safeFetchJson<DeleteGroupAssetResponse>('/api/storage/assets', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket: GROUP_ASSETS_BUCKET,
      path,
      url,
      orgId,
      groupId,
    }),
    timeoutMs: 12_000,
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.data.data;
}

export async function tryDeleteGroupAsset(input: Parameters<typeof deleteGroupAsset>[0]) {
  try {
    return await deleteGroupAsset(input);
  } catch (error) {
    console.warn('Storage asset cleanup failed', error);
    return { deleted: false };
  }
}
