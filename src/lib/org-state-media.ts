export const STRIPPED_ASSET_TYPE = 'stripped_asset' as const;

export type StrippedAssetPlaceholder = {
  type: typeof STRIPPED_ASSET_TYPE;
  url: string;
};

const DATA_URL_BASE64_PATTERN = /^data:[^;,]+;base64,/i;
const RAW_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_RAW_BASE64_LENGTH = 2048;

export const createStrippedAssetPlaceholder = (): StrippedAssetPlaceholder => ({
  type: STRIPPED_ASSET_TYPE,
  url: '',
});

export const isStrippedAssetPlaceholder = (value: unknown): value is StrippedAssetPlaceholder =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === STRIPPED_ASSET_TYPE
  );

export const isInlineAssetString = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/')) return true;
  if (DATA_URL_BASE64_PATTERN.test(trimmed)) return true;
  if (trimmed.length < MIN_RAW_BASE64_LENGTH || trimmed.length % 4 !== 0) return false;
  return RAW_BASE64_PATTERN.test(trimmed);
};

export const stripHeavyMediaFromOrgState = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return isInlineAssetString(value) ? createStrippedAssetPlaceholder() : value;
  }

  if (Array.isArray(value)) {
    return value.map(stripHeavyMediaFromOrgState);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      stripHeavyMediaFromOrgState(entry),
    ])
  );
};

export const restoreStrippedAssets = (currentValue: unknown, nextValue: unknown): unknown => {
  if (isStrippedAssetPlaceholder(nextValue)) {
    return currentValue ?? nextValue;
  }

  if (Array.isArray(nextValue)) {
    const currentArray = Array.isArray(currentValue) ? currentValue : [];
    return nextValue.map((entry, index) => restoreStrippedAssets(currentArray[index], entry));
  }

  if (!nextValue || typeof nextValue !== 'object') {
    return nextValue;
  }

  const currentRecord =
    currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
      ? (currentValue as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    Object.entries(nextValue as Record<string, unknown>).map(([key, entry]) => [
      key,
      restoreStrippedAssets(currentRecord[key], entry),
    ])
  );
};
