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

export const sanitizeGroupAssetFilename = (fileName: string, mimeType: string) => {
  const extension = extensionFromMimeType(mimeType);
  const fallback = `asset.${extension}`;
  const normalized = (fileName.trim() || fallback)
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  const withName = normalized || fallback;
  const baseName = withName.replace(/\.[a-zA-Z0-9]{2,5}$/, '') || 'asset';
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
