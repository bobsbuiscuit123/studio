export const GROUP_ASSETS_BUCKET = 'group-assets';

export const GROUP_ASSET_SCOPES = ['announcement', 'form-response'] as const;
export type GroupAssetScope = (typeof GROUP_ASSET_SCOPES)[number];

const extensionFromMimeType = (mimeType: string) => {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('csv')) return 'csv';
  if (normalized.includes('plain')) return 'txt';
  if (normalized.includes('wordprocessingml')) return 'docx';
  if (normalized.includes('msword')) return 'doc';
  if (normalized.includes('spreadsheetml')) return 'xlsx';
  if (normalized.includes('excel')) return 'xls';
  if (normalized.includes('presentationml')) return 'pptx';
  if (normalized.includes('powerpoint')) return 'ppt';
  return 'bin';
};

export const isGroupAssetScope = (value: unknown): value is GroupAssetScope =>
  typeof value === 'string' && GROUP_ASSET_SCOPES.includes(value as GroupAssetScope);

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

export const sanitizeGroupAssetFilename = (fileName: string, mimeType: string) => {
  const extension = extensionFromMimeType(mimeType);
  const fallback = `asset.${extension}`;
  const normalized = sanitizeFilenameText(fileName, fallback);
  const withName = normalized || fallback;
  const baseName = stripFileExtension(withName) || 'asset';
  return `${baseName}.${extension}`;
};

export const buildGroupAssetPath = ({
  orgId,
  groupId,
  fileName,
  timestamp = Date.now(),
}: {
  orgId: string;
  groupId: string;
  fileName: string;
  timestamp?: number;
}) => `${orgId}/${groupId}/${timestamp}-${fileName}`;

export const getGroupAssetObjectPathFromPublicUrl = (url: string) => {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${GROUP_ASSETS_BUCKET}/`;
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

export const isManagedGroupAssetUrl = (url?: string | null) =>
  typeof url === 'string' && Boolean(getGroupAssetObjectPathFromPublicUrl(url));
