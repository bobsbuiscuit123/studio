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

const isSafeFilenameChar = (char: string) =>
  (char >= 'a' && char <= 'z') ||
  (char >= 'A' && char <= 'Z') ||
  (char >= '0' && char <= '9') ||
  char === '.' ||
  char === '_' ||
  char === '-';

const trimEdgeDashes = (value: string) => {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
};

const sanitizeFilenameText = (value: string, fallback: string) => {
  let next = '';
  let lastWasDash = false;
  for (const char of value.trim() || fallback) {
    if (isSafeFilenameChar(char)) {
      next += char;
      lastWasDash = char === '-';
    } else if (!lastWasDash) {
      next += '-';
      lastWasDash = true;
    }
  }
  return trimEdgeDashes(next).slice(0, 120);
};

const hasAlphaNumericExtension = (value: string) => {
  if (value.length < 2 || value.length > 5) return false;
  for (const char of value) {
    const isAlphaNumeric =
      (char >= 'a' && char <= 'z') ||
      (char >= 'A' && char <= 'Z') ||
      (char >= '0' && char <= '9');
    if (!isAlphaNumeric) return false;
  }
  return true;
};

const stripFileExtension = (value: string) => {
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex <= 0) return value;
  const extension = value.slice(dotIndex + 1);
  return hasAlphaNumericExtension(extension) ? value.slice(0, dotIndex) : value;
};

export const sanitizeStorageFilename = (fileName: string, mimeType: string) => {
  const fallback = `image.${extensionFromImageMimeType(mimeType)}`;
  const extension = extensionFromImageMimeType(mimeType);
  const normalized = sanitizeFilenameText(fileName, fallback);

  const withName = normalized || fallback;
  const baseName = stripFileExtension(withName) || 'image';
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
