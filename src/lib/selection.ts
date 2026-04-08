"use client";

const ORG_ID_KEY = "selectedOrgId";
const GROUP_ID_KEY = "selectedGroupId";

const setCookie = (key: string, value: string, persistent = true) => {
  const persistence = persistent ? '; max-age=31536000' : '';
  document.cookie = `${key}=${encodeURIComponent(value)}; path=/${persistence}`;
};

const clearCookie = (key: string) => {
  document.cookie = `${key}=; path=/; max-age=0`;
};

const readCookie = (key: string) => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

export const syncSelectionCookies = () => {
  if (typeof window === "undefined") {
    return { orgId: null, groupId: null };
  }

  const orgCookieValue = readCookie(ORG_ID_KEY);
  const storedOrgId = localStorage.getItem(ORG_ID_KEY) || orgCookieValue;
  if (storedOrgId) {
    localStorage.setItem(ORG_ID_KEY, storedOrgId);
    if (orgCookieValue !== storedOrgId) {
      setCookie(ORG_ID_KEY, storedOrgId, true);
    }
  }

  const sessionGroupValue = window.sessionStorage.getItem(GROUP_ID_KEY);
  const cookieGroupValue = readCookie(GROUP_ID_KEY);
  const legacyLocalGroupValue = localStorage.getItem(GROUP_ID_KEY);

  if (!sessionGroupValue && legacyLocalGroupValue) {
    window.sessionStorage.setItem(GROUP_ID_KEY, legacyLocalGroupValue);
  }
  if (legacyLocalGroupValue) {
    localStorage.removeItem(GROUP_ID_KEY);
  }

  const storedGroupId =
    window.sessionStorage.getItem(GROUP_ID_KEY) || cookieGroupValue;
  if (storedGroupId) {
    if (!window.sessionStorage.getItem(GROUP_ID_KEY)) {
      window.sessionStorage.setItem(GROUP_ID_KEY, storedGroupId);
    }
    if (cookieGroupValue !== storedGroupId) {
      setCookie(GROUP_ID_KEY, storedGroupId, false);
    }
  }

  return {
    orgId: storedOrgId || null,
    groupId: storedGroupId || null,
  };
};

export const getSelectedOrgId = () => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ORG_ID_KEY) || readCookie(ORG_ID_KEY);
};

export const setSelectedOrgId = (orgId: string) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(ORG_ID_KEY, orgId);
  setCookie(ORG_ID_KEY, orgId, true);
};

export const clearSelectedOrgId = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ORG_ID_KEY);
  clearCookie(ORG_ID_KEY);
};

export const getSelectedGroupId = () => {
  if (typeof window === "undefined") return null;
  const sessionValue = window.sessionStorage.getItem(GROUP_ID_KEY);
  const cookieValue = readCookie(GROUP_ID_KEY);
  const legacyLocalValue = localStorage.getItem(GROUP_ID_KEY);
  if (!sessionValue && legacyLocalValue) {
    localStorage.removeItem(GROUP_ID_KEY);
  }
  if (sessionValue) {
    return sessionValue;
  }
  if (cookieValue) {
    window.sessionStorage.setItem(GROUP_ID_KEY, cookieValue);
    return cookieValue;
  }
  return null;
};

export const setSelectedGroupId = (groupId: string) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(GROUP_ID_KEY, groupId);
  localStorage.removeItem(GROUP_ID_KEY);
  setCookie(GROUP_ID_KEY, groupId, false);
};

export const clearSelectedGroupId = () => {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(GROUP_ID_KEY);
  localStorage.removeItem(GROUP_ID_KEY);
  clearCookie(GROUP_ID_KEY);
};
