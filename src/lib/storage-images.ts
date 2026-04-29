import { safeFetchJson } from '@/lib/network';
import {
  GROUP_GALLERIES_BUCKET,
  getStorageObjectPathFromPublicUrl,
  isManagedStorageImageUrl,
  type StoredImageScope,
} from '@/lib/storage-image-paths';

type UploadImageResponse = {
  ok: true;
  data: {
    bucket: string;
    path: string;
    url: string;
  };
};

type DeleteImageResponse = {
  ok: true;
  data: {
    deleted: boolean;
  };
};

export async function uploadImageToStorage({
  file,
  orgId,
  groupId,
  scope,
  fileName,
}: {
  file: File;
  orgId: string;
  groupId?: string | null;
  scope: StoredImageScope;
  fileName?: string;
}) {
  const formData = new FormData();
  formData.set('file', file, fileName || file.name);
  formData.set('orgId', orgId);
  formData.set('scope', scope);
  if (groupId) {
    formData.set('groupId', groupId);
  }
  if (fileName) {
    formData.set('fileName', fileName);
  }

  const response = await safeFetchJson<UploadImageResponse>('/api/storage/images', {
    method: 'POST',
    body: formData,
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.data.data;
}

export async function deleteStoredImage({
  url,
  orgId,
  groupId,
  scope,
}: {
  url?: string | null;
  orgId: string;
  groupId?: string | null;
  scope: StoredImageScope;
}) {
  if (!url || !isManagedStorageImageUrl(url)) {
    return { deleted: false };
  }

  const path = getStorageObjectPathFromPublicUrl(url);
  const response = await safeFetchJson<DeleteImageResponse>('/api/storage/images', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket: GROUP_GALLERIES_BUCKET,
      path,
      url,
      orgId,
      groupId,
      scope,
    }),
    timeoutMs: 12_000,
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.data.data;
}

export async function tryDeleteStoredImage(input: Parameters<typeof deleteStoredImage>[0]) {
  try {
    return await deleteStoredImage(input);
  } catch (error) {
    console.warn('Storage image cleanup failed', error);
    return { deleted: false };
  }
}
