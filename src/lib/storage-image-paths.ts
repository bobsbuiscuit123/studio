export const GROUP_GALLERIES_BUCKET = 'group-galleries';

export const STORED_IMAGE_SCOPES = [
  'gallery',
  'avatar',
  'group-logo',
  'org-logo',
] as const;

export type StoredImageScope = (typeof STORED_IMAGE_SCOPES)[number];

const FALLBACK_IMAGE_EXTENSION = 'jpg';

export const isStoredImageScope = (value: unknown): value is StoredImageScope =>
  typeof value === 'string' && STORED_IMAGE_SCOPES.includes(value as StoredImageScope);

export const extensionFromImageMimeType = (mimeType: string) => {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  return FALLBACK_IMAGE_EXTENSION;
};

export const sanitizeStorageFilename = (fileName: string, mimeType: string) => {
  const trimmed = fileName.trim();
  const fallback = `image.${extensionFromImageMimeType(mimeType)}`;
  const extension = extensionFromImageMimeType(mimeType);
  const normalized = (trimmed || fallback)
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  const withName = normalized || fallback;
  const baseName = withName.replace(/\.[a-zA-Z0-9]{2,5}$/, '') || 'image';
  return `${baseName}.${extension}`;
};

export const buildStoredImagePath = ({
  orgId,
  groupId,
  scope,
  userId,
  fileName,
  timestamp = Date.now(),
}: {
  orgId: string;
  groupId?: string | null;
  scope: StoredImageScope;
  userId?: string | null;
  fileName: string;
  timestamp?: number;
}) => {
  switch (scope) {
    case 'gallery':
    case 'group-logo':
      if (!groupId) {
        throw new Error('A group id is required for group image uploads.');
      }
      return `${orgId}/${groupId}/${timestamp}-${fileName}`;
    case 'avatar':
      return `${orgId}/profiles/${userId || 'current-user'}/${timestamp}-${fileName}`;
    case 'org-logo':
      return `${orgId}/org-logo/${timestamp}-${fileName}`;
    default:
      return `${orgId}/${timestamp}-${fileName}`;
  }
};

export const getStorageObjectPathFromPublicUrl = (url: string) => {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${GROUP_GALLERIES_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const path = parsed.pathname.slice(markerIndex + marker.length);
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
};

export const isManagedStorageImageUrl = (url?: string | null) =>
  typeof url === 'string' && Boolean(getStorageObjectPathFromPublicUrl(url));
