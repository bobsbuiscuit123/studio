import {
  clearSelectedGroupId,
  clearSelectedOrgId,
  getSelectedGroupId,
  getSelectedOrgId,
  setSelectedGroupId,
  setSelectedOrgId,
  syncSelectionCookies,
} from './selection';

class MockStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

const createCookieDocument = () => {
  const cookies = new Map<string, string>();
  const doc: Record<string, unknown> = {};

  Object.defineProperty(doc, 'cookie', {
    configurable: true,
    get() {
      return Array.from(cookies.entries())
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('; ');
    },
    set(value: string) {
      const [pair, ...attributes] = value.split(';').map(part => part.trim());
      const [key, rawValue = ''] = pair.split('=');
      const maxAge = attributes.find(attribute =>
        attribute.toLowerCase().startsWith('max-age=')
      );

      if (maxAge?.split('=')[1] === '0') {
        cookies.delete(key);
        return;
      }

      cookies.set(key, decodeURIComponent(rawValue));
    },
  });

  return doc as unknown as Document;
};

describe('selection helpers', () => {
  beforeEach(() => {
    const localStorage = new MockStorage();
    const sessionStorage = new MockStorage();
    const document = createCookieDocument();

    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('window', { localStorage, sessionStorage });
    vi.stubGlobal('document', document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reasserts missing selection cookies from client storage', () => {
    setSelectedOrgId('org-1');
    setSelectedGroupId('group-1');

    document.cookie = 'selectedOrgId=; path=/; max-age=0';
    document.cookie = 'selectedGroupId=; path=/; max-age=0';

    expect(getSelectedOrgId()).toBe('org-1');
    expect(getSelectedGroupId()).toBe('group-1');

    const synced = syncSelectionCookies();

    expect(synced).toEqual({ orgId: 'org-1', groupId: 'group-1' });
    expect(document.cookie).toContain('selectedOrgId=org-1');
    expect(document.cookie).toContain('selectedGroupId=group-1');
  });

  it('migrates legacy group storage into session storage and cookies', () => {
    localStorage.setItem('selectedGroupId', 'legacy-group');

    const synced = syncSelectionCookies();

    expect(synced.groupId).toBe('legacy-group');
    expect(window.sessionStorage.getItem('selectedGroupId')).toBe('legacy-group');
    expect(localStorage.getItem('selectedGroupId')).toBeNull();
    expect(document.cookie).toContain('selectedGroupId=legacy-group');
  });

  it('clears selection storage and cookies', () => {
    setSelectedOrgId('org-1');
    setSelectedGroupId('group-1');

    clearSelectedOrgId();
    clearSelectedGroupId();

    expect(getSelectedOrgId()).toBeNull();
    expect(getSelectedGroupId()).toBeNull();
    expect(document.cookie).not.toContain('selectedOrgId=');
    expect(document.cookie).not.toContain('selectedGroupId=');
  });
});
