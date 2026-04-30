export type OrgListCacheItem = {
  id: string | null;
};

export const ORGS_CACHE_KEY = 'view-cache:orgs:list';
export const ORG_MEMBERSHIP_CHANGED_EVENT = 'org-membership-changed';

export const orgListHasOrg = (
  orgs: OrgListCacheItem[] | null | undefined,
  orgId: string | null | undefined
) => {
  if (!orgId) {
    return true;
  }
  return (orgs ?? []).some(org => org.id === orgId);
};
