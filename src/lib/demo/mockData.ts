import type { OrgState } from '@/lib/org-state';
import { getPlaceholderImageUrl } from '@/lib/placeholders';
import type {
  Announcement,
  ClubEvent,
  ClubForm,
  GalleryImage,
  GroupChat,
  Member,
  Message,
  PointEntry,
  SocialPost,
  Transaction,
  User,
} from '@/lib/mock-data';

export const DEMO_MODE_ENABLED = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
export const DEMO_SESSION_STORAGE_KEY = 'clubhub_demo_session';
export const DEMO_TAB_SESSION_STORAGE_KEY = 'clubhub_demo_session_tab';
export const DEMO_SHARED_STATE_STORAGE_KEY = 'clubhub_demo_shared_state';
export const DEMO_SHARED_GROUP_STORAGE_KEY = 'clubhub_demo_shared_group';
export const DEMO_SHARED_STATE_MAX_AGE_MS = 1000 * 60 * 60 * 6;

export type DemoRole = 'Admin' | 'Parent' | 'Student' | 'Officer';
export type DemoAppRole = 'Admin' | 'Member' | 'Officer';

export type DemoGroup = {
  id: string;
  name: string;
  joinCode: string;
  category: string;
  description: string;
  meetingTime: string;
  logo: string;
};

export type DemoSession = {
  role: DemoRole;
  appRole: DemoAppRole;
  groupId: string;
  groupName: string;
  startedAt: string;
  user: User;
};

const BASE_DATE = new Date('2026-02-08T10:00:00.000Z');

const addDays = (days: number) => {
  const next = new Date(BASE_DATE);
  next.setDate(next.getDate() + days);
  return next;
};

const addDaysIso = (days: number) => addDays(days).toISOString();

const createMessage = (
  sender: string,
  text: string,
  daysFromBase: number,
  readBy: string[]
): Message => ({
  sender,
  text,
  timestamp: addDaysIso(daysFromBase),
  readBy,
});

const createMembers = (groupName: string): Member[] => [
  {
    id: `president-${groupName.toLowerCase().replace(/\s+/g, '-')}`,
    name: 'Jordan Lee',
    email: 'jordan.lee@clubhub.demo',
    role: 'Admin',
    avatar: getPlaceholderImageUrl({ label: 'J' }),
  },
  {
    id: `officer-${groupName.toLowerCase().replace(/\s+/g, '-')}`,
    name: 'Maya Patel',
    email: 'maya.patel@clubhub.demo',
    role: 'Officer',
    avatar: getPlaceholderImageUrl({ label: 'M' }),
  },
  {
    id: `member-${groupName.toLowerCase().replace(/\s+/g, '-')}`,
    name: 'Evan Kim',
    email: 'evan.kim@clubhub.demo',
    role: 'Member',
    avatar: getPlaceholderImageUrl({ label: 'E' }),
  },
];

const createAnnouncements = (groupName: string): Announcement[] => [
  {
    id: 1001,
    title: `${groupName}: Spring kickoff`,
    content:
      'Welcome back. Please review the monthly goals and RSVP for kickoff night.',
    author: 'jordan.lee@clubhub.demo',
    date: addDaysIso(-3),
    read: false,
    viewedBy: [],
    tags: ['kickoff', 'planning'],
  },
  {
    id: 1002,
    title: 'Volunteer schedule posted',
    content:
      'Sign-up slots are now available. Officers will confirm assignments tomorrow.',
    author: 'maya.patel@clubhub.demo',
    date: addDaysIso(-1),
    read: false,
    viewedBy: [],
    tags: ['volunteer'],
  },
];

const createEvents = (groupName: string): ClubEvent[] => [
  {
    id: `${groupName}-evt-1`,
    title: `${groupName} weekly meeting`,
    description: 'Agenda review, member updates, and action items.',
    location: 'Room 201',
    date: addDays(2),
    read: false,
    rsvpRequired: true,
    rsvps: { yes: ['jordan.lee@clubhub.demo'], no: [], maybe: [] },
    attendees: ['jordan.lee@clubhub.demo'],
    viewedBy: [],
  },
  {
    id: `${groupName}-evt-2`,
    title: 'Community showcase',
    description: 'Team presentations and parent attendance welcome.',
    location: 'Main Hall',
    date: addDays(6),
    read: false,
    rsvpRequired: true,
    rsvps: { yes: [], no: [], maybe: [] },
    attendees: [],
    viewedBy: [],
  },
];

const createSocialPosts = (): SocialPost[] => [
  {
    id: 201,
    title: 'Practice session highlights',
    content: 'Great turnout and strong collaboration from all groups.',
    images: [getPlaceholderImageUrl({ label: 'Hi', width: 600, height: 400 })],
    author: 'maya.patel@clubhub.demo',
    date: addDaysIso(-2),
    likes: 8,
    comments: [{ author: 'evan.kim@clubhub.demo', text: 'Awesome recap!' }],
    read: false,
  },
];

const createTransactions = (): Transaction[] => [
  {
    id: 'txn-1',
    description: 'Venue reservation',
    amount: 180,
    date: addDaysIso(-4),
    status: 'Deposit',
  },
  {
    id: 'txn-2',
    description: 'Snack supplies',
    amount: -62,
    date: addDaysIso(-1),
    status: 'Withdrawal',
  },
];

const createDirectMessages = (): { [key: string]: Message[] } => ({
  'maya.patel@clubhub.demo': [
    createMessage(
      'maya.patel@clubhub.demo',
      'Can someone confirm tomorrow attendance by 6 PM?',
      -1,
      []
    ),
  ],
  'jordan.lee@clubhub.demo': [
    createMessage(
      'jordan.lee@clubhub.demo',
      'Budget file has been updated in shared drive.',
      -2,
      []
    ),
  ],
});

const createGroupChats = (): GroupChat[] => [
  {
    id: 'chat-officers',
    name: 'Officer Room',
    members: [
      'jordan.lee@clubhub.demo',
      'maya.patel@clubhub.demo',
      'evan.kim@clubhub.demo',
    ],
    messages: [
      createMessage(
        'jordan.lee@clubhub.demo',
        'Please review the event timeline draft.',
        -2,
        ['jordan.lee@clubhub.demo']
      ),
      createMessage(
        'maya.patel@clubhub.demo',
        'I can take volunteer coordination.',
        -1,
        ['maya.patel@clubhub.demo']
      ),
    ],
  },
];

const createGalleryImages = (): GalleryImage[] => [
  {
    id: 301,
    src: getPlaceholderImageUrl({ label: 'G1', width: 800, height: 600 }),
    alt: 'Group meeting photo',
    author: 'evan.kim@clubhub.demo',
    date: addDaysIso(-3),
    likes: 12,
    likedBy: [],
    status: 'approved',
    read: false,
  },
];

const createPointEntries = (): PointEntry[] => [
  {
    id: 'pts-1',
    memberEmail: 'evan.kim@clubhub.demo',
    points: 10,
    reason: 'Helped setup event space',
    date: addDaysIso(-2),
    awardedBy: 'maya.patel@clubhub.demo',
  },
];

const createForms = (): ClubForm[] => [
  {
    id: 'form-1',
    title: 'Field Trip Consent',
    description: "Required before next week's event.",
    questions: [
      { id: 'q1', prompt: 'Student full name', required: true, kind: 'shortText' },
      { id: 'q2', prompt: 'Emergency contact number', required: true, kind: 'shortText' },
    ],
    createdBy: 'jordan.lee@clubhub.demo',
    createdAt: addDaysIso(-4),
    viewedBy: [],
    responses: [],
  },
];

const createOrgState = (group: DemoGroup): OrgState => ({
  members: createMembers(group.name),
  events: createEvents(group.name),
  announcements: createAnnouncements(group.name),
  socialPosts: createSocialPosts(),
  transactions: createTransactions(),
  messages: createDirectMessages(),
  groupChats: createGroupChats(),
  galleryImages: createGalleryImages(),
  pointEntries: createPointEntries(),
  presentations: [],
  forms: createForms(),
  logo: group.logo,
  mindmap: {
    nodes: [
      {
        id: 'demo-node-root',
        type: 'input',
        data: { label: `${group.name} Demo Plan` },
        position: { x: 250, y: 5 },
      },
    ],
    edges: [],
  },
});

export const DEMO_ROLE_TO_APP_ROLE: Record<DemoRole, DemoAppRole> = {
  Admin: 'Admin',
  Student: 'Officer',
  Officer: 'Officer',
  Parent: 'Member',
};

export const DEMO_GROUPS: DemoGroup[] = [
  {
    id: 'demo-robotics',
    name: 'Robotics League',
    joinCode: 'RB01',
    category: 'STEM',
    description: 'Builds autonomous challenge bots and mentors first-year members.',
    meetingTime: 'Tuesdays at 4 PM',
    logo: getPlaceholderImageUrl({ label: 'R' }),
  },
  {
    id: 'demo-debate',
    name: 'Debate Union',
    joinCode: 'DB02',
    category: 'Academic',
    description: 'Weekly policy debate practice and tournament prep.',
    meetingTime: 'Wednesdays at 3:30 PM',
    logo: getPlaceholderImageUrl({ label: 'D' }),
  },
  {
    id: 'demo-service',
    name: 'Service Squad',
    joinCode: 'SV03',
    category: 'Service',
    description: 'Coordinates local outreach and community events.',
    meetingTime: 'Fridays at 2 PM',
    logo: getPlaceholderImageUrl({ label: 'S' }),
  },
];

const ORG_STATE_BY_GROUP_ID: Record<string, OrgState> = Object.fromEntries(
  DEMO_GROUPS.map(group => [group.id, createOrgState(group)])
);

const cloneOrgState = (state: OrgState): OrgState => ({
  ...state,
  members: state.members.map(member => ({ ...member })),
  events: state.events.map(event => ({ ...event, date: new Date(event.date) })),
  announcements: state.announcements.map(item => ({ ...item })),
  socialPosts: state.socialPosts.map(item => ({ ...item, comments: item.comments.map(c => ({ ...c })) })),
  transactions: state.transactions.map(item => ({ ...item })),
  messages: Object.fromEntries(
    Object.entries(state.messages).map(([key, messages]) => [
      key,
      messages.map(message => ({ ...message, readBy: [...message.readBy] })),
    ])
  ),
  groupChats: state.groupChats.map(chat => ({
    ...chat,
    members: [...chat.members],
    messages: chat.messages.map(message => ({ ...message, readBy: [...message.readBy] })),
  })),
  galleryImages: state.galleryImages.map(image => ({ ...image, likedBy: image.likedBy ? [...image.likedBy] : undefined })),
  pointEntries: state.pointEntries.map(entry => ({ ...entry })),
  presentations: state.presentations.map(presentation => ({
    ...presentation,
    slides: presentation.slides.map(slide => ({ ...slide })),
  })),
  forms: state.forms.map(form => ({
    ...form,
    questions: form.questions.map(question => ({ ...question, options: question.options ? [...question.options] : undefined })),
    viewedBy: [...form.viewedBy],
    responses: form.responses.map(response => ({
      ...response,
      answers: { ...response.answers },
    })),
  })),
  mindmap: {
    nodes: state.mindmap.nodes.map(node => ({ ...node, data: { ...node.data }, position: { ...node.position } })),
    edges: state.mindmap.edges.map(edge => ({ ...edge })),
  },
});

const cloneOrgStateMap = (stateMap: Record<string, OrgState>) =>
  Object.fromEntries(
    Object.entries(stateMap).map(([groupId, state]) => [groupId, cloneOrgState(state)])
  );

export const getDemoGroupById = (groupId: string) =>
  DEMO_GROUPS.find(group => group.id === groupId) ?? DEMO_GROUPS[0];

export const getInitialDemoOrgStateMap = () => cloneOrgStateMap(ORG_STATE_BY_GROUP_ID);

type DemoSharedStatePayload = {
  savedAt: number;
  orgStateByGroupId: Record<string, OrgState>;
};

export const loadDemoSharedState = (): Record<string, OrgState> => {
  const fallback = getInitialDemoOrgStateMap();
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(DEMO_SHARED_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as DemoSharedStatePayload;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.orgStateByGroupId ||
      typeof parsed.orgStateByGroupId !== 'object'
    ) {
      localStorage.removeItem(DEMO_SHARED_STATE_STORAGE_KEY);
      return fallback;
    }
    const isFresh = Date.now() - parsed.savedAt <= DEMO_SHARED_STATE_MAX_AGE_MS;
    if (!isFresh) {
      localStorage.removeItem(DEMO_SHARED_STATE_STORAGE_KEY);
      return fallback;
    }
    return cloneOrgStateMap(parsed.orgStateByGroupId);
  } catch {
    localStorage.removeItem(DEMO_SHARED_STATE_STORAGE_KEY);
    return fallback;
  }
};

export const saveDemoSharedState = (stateMap: Record<string, OrgState>) => {
  if (typeof window === 'undefined') return;
  const payload: DemoSharedStatePayload = {
    savedAt: Date.now(),
    orgStateByGroupId: stateMap,
  };
  localStorage.setItem(DEMO_SHARED_STATE_STORAGE_KEY, JSON.stringify(payload));
};

const createDemoUser = (role: DemoRole): User => {
  const slug = role.toLowerCase();
  return {
    name: `Demo ${role}`,
    email: `${slug}@clubhub.demo`,
    avatar: getPlaceholderImageUrl({ label: role.charAt(0) }),
  };
};

export const createDemoSession = (role: DemoRole, preferredGroupId?: string): DemoSession => {
  const preferredGroup = preferredGroupId
    ? DEMO_GROUPS.find(group => group.id === preferredGroupId)
    : null;
  const randomGroup = preferredGroup ?? DEMO_GROUPS[Math.floor(Math.random() * DEMO_GROUPS.length)];
  const appRole = DEMO_ROLE_TO_APP_ROLE[role];
  return {
    role,
    appRole,
    groupId: randomGroup.id,
    groupName: randomGroup.name,
    startedAt: new Date().toISOString(),
    user: createDemoUser(role),
  };
};

export const parseDemoSession = (value: string | null): DemoSession | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as DemoSession;
    if (!parsed?.groupId || !parsed?.groupName || !parsed?.role || !parsed?.user?.email) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const getStoredDemoSession = (): DemoSession | null => {
  if (typeof window === 'undefined') return null;
  const tabSession = parseDemoSession(sessionStorage.getItem(DEMO_TAB_SESSION_STORAGE_KEY));
  if (tabSession) return tabSession;
  return parseDemoSession(localStorage.getItem(DEMO_SESSION_STORAGE_KEY));
};

export const storeDemoSession = (session: DemoSession) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(session));
  sessionStorage.setItem(DEMO_TAB_SESSION_STORAGE_KEY, JSON.stringify(session));
  localStorage.setItem(DEMO_SHARED_GROUP_STORAGE_KEY, session.groupId);
  sessionStorage.setItem(DEMO_SHARED_GROUP_STORAGE_KEY, session.groupId);
};

export const clearStoredDemoSession = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
  sessionStorage.removeItem(DEMO_TAB_SESSION_STORAGE_KEY);
};

export const getStoredDemoGroupId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const sessionGroupId = sessionStorage.getItem(DEMO_SHARED_GROUP_STORAGE_KEY);
  if (sessionGroupId) return sessionGroupId;
  return localStorage.getItem(DEMO_SHARED_GROUP_STORAGE_KEY);
};
