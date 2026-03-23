type PlaceholderOptions = {
  label?: string | null;
  width?: number;
  height?: number;
  background?: string;
  foreground?: string;
};

const DEFAULT_BACKGROUND = '#E7EFE1';
const DEFAULT_FOREGROUND = '#234035';

const clampLabel = (value?: string | null) => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 2).toUpperCase() : '?';
};

export function getPlaceholderImageUrl({
  label,
  width = 100,
  height = 100,
  background = DEFAULT_BACKGROUND,
  foreground = DEFAULT_FOREGROUND,
}: PlaceholderOptions = {}) {
  const safeLabel = clampLabel(label);
  const fontSize = Math.max(18, Math.floor(Math.min(width, height) * 0.42));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeLabel}"><rect width="100%" height="100%" fill="${background}"/><text x="50%" y="50%" fill="${foreground}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
