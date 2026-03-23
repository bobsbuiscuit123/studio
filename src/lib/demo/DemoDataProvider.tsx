'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { OrgState } from '@/lib/org-state';
import type { Member, User } from '@/lib/mock-data';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import {
  DEMO_SHARED_STATE_STORAGE_KEY,
  DEMO_GROUPS,
  DEMO_ROLE_TO_APP_ROLE,
  getDemoGroupById,
  loadDemoSharedState,
  saveDemoSharedState,
  type DemoAppRole,
  type DemoGroup,
  type DemoSession,
} from '@/lib/demo/mockData';

type DemoContextValue = {
  session: DemoSession;
  groups: DemoGroup[];
  clubId: string;
  clubName: string;
  appRole: DemoAppRole;
  user: User;
  clubData: OrgState;
  updateClubData: (next: OrgState | ((previous: OrgState) => OrgState)) => void;
  updateUser: (next: Partial<User> | ((previous: User) => User)) => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

const mergeUserIntoMembers = (members: Member[], user: User, appRole: DemoAppRole): Member[] => {
  const updatedMember: Member = {
    id: `demo-${user.email}`,
    name: user.name,
    email: user.email,
    role: appRole,
    avatar: user.avatar || getPlaceholderImageUrl({ label: user.name.charAt(0) }),
  };

  const existingIndex = members.findIndex(member => member.email === user.email);
  if (existingIndex === -1) {
    return [updatedMember, ...members];
  }
  return members.map((member, index) => (index === existingIndex ? updatedMember : member));
};

export function DemoDataProvider({
  initialSession,
  children,
}: {
  initialSession: DemoSession;
  children: ReactNode;
}) {
  const [session] = useState<DemoSession>(initialSession);
  const [user, setUser] = useState<User>(initialSession.user);
  const [initialStateByGroupId] = useState<Record<string, OrgState>>(() =>
    loadDemoSharedState()
  );
  const [orgStateByGroupId, setOrgStateByGroupId] = useState<Record<string, OrgState>>(() =>
    initialStateByGroupId
  );

  useEffect(() => {
    saveDemoSharedState(orgStateByGroupId);
  }, [orgStateByGroupId]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEMO_SHARED_STATE_STORAGE_KEY) return;
      setOrgStateByGroupId(loadDemoSharedState());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clubId = session.groupId;
  const group = getDemoGroupById(clubId);
  const appRole = DEMO_ROLE_TO_APP_ROLE[session.role];
  const rawClubData = orgStateByGroupId[clubId] ?? initialStateByGroupId[clubId];
  const clubData = useMemo(
    () => ({
      ...rawClubData,
      members: mergeUserIntoMembers(rawClubData.members, user, appRole),
    }),
    [appRole, rawClubData, user]
  );

  const updateClubData = useCallback(
    (next: OrgState | ((previous: OrgState) => OrgState)) => {
      setOrgStateByGroupId(previousMap => {
        const previousForClub = previousMap[clubId] ?? rawClubData;
        const nextValue =
          typeof next === 'function'
            ? (next as (previous: OrgState) => OrgState)(previousForClub)
            : next;
        return {
          ...previousMap,
          [clubId]: {
            ...nextValue,
            members: mergeUserIntoMembers(nextValue.members, user, appRole),
          },
        };
      });
    },
    [appRole, clubId, rawClubData, user]
  );

  const updateUser = useCallback(
    (next: Partial<User> | ((previous: User) => User)) => {
      setUser(previous =>
        typeof next === 'function' ? (next as (previous: User) => User)(previous) : { ...previous, ...next }
      );
    },
    []
  );

  const value = useMemo<DemoContextValue>(
    () => ({
      session,
      groups: DEMO_GROUPS,
      clubId,
      clubName: group.name,
      appRole,
      user,
      clubData,
      updateClubData,
      updateUser,
    }),
    [appRole, clubData, clubId, group.name, session, updateClubData, updateUser, user]
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export const useDemoCtx = () => {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error('useDemoCtx must be used within DemoDataProvider.');
  }
  return context;
};

export const useOptionalDemoCtx = () => useContext(DemoContext);
