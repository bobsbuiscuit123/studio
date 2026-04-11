"use client";

type TimedCacheRecord<T> = {
  savedAt: number;
  value: T;
};

const parseCacheRecord = <T>(rawValue: string | null): TimedCacheRecord<T> | null => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as TimedCacheRecord<T>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.savedAt !== 'number' ||
      !('value' in parsed)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const readLocalViewCache = <T>(key: string, maxAgeMs: number) => {
  if (typeof window === 'undefined') {
    return null;
  }

  const parsed = parseCacheRecord<T>(window.localStorage.getItem(key));
  if (!parsed) {
    return null;
  }

  if (Date.now() - parsed.savedAt >= maxAgeMs) {
    return null;
  }

  return parsed.value;
};

export const readLocalViewCacheRecord = <T>(key: string) => {
  if (typeof window === 'undefined') {
    return null;
  }

  return parseCacheRecord<T>(window.localStorage.getItem(key));
};

export const writeLocalViewCache = <T>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const record: TimedCacheRecord<T> = {
      savedAt: Date.now(),
      value,
    };
    window.localStorage.setItem(key, JSON.stringify(record));
  } catch (error) {
    console.error(`Failed to write local cache for ${key}`, error);
  }
};

export const removeLocalViewCache = (key: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(key);
};
