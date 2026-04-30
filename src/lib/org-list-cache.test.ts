import { orgListHasOrg } from './org-list-cache';

describe('organization list cache helpers', () => {
  it('detects when the selected organization is missing from a cached list', () => {
    expect(orgListHasOrg([{ id: 'org-1' }], 'org-2')).toBe(false);
  });

  it('accepts cached lists that contain the selected organization', () => {
    expect(orgListHasOrg([{ id: 'org-1' }, { id: 'org-2' }], 'org-2')).toBe(true);
  });

  it('does not require a selected organization', () => {
    expect(orgListHasOrg([{ id: 'org-1' }], null)).toBe(true);
  });
});
