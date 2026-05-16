import type {
  Announcement,
  ClubEvent,
  GalleryImage,
  GroupChat,
  Message,
  MindMapData,
  PointEntry,
  Presentation,
  SocialPost,
  Transaction,
  ClubForm,
  DonorRecord,
  Member,
} from '@/lib/mock-data';

export type OrgState = {
  members: Member[];
  donors: DonorRecord[];
  events: ClubEvent[];
  announcements: Announcement[];
  socialPosts: SocialPost[];
  transactions: Transaction[];
  messages: { [key: string]: Message[] };
  groupChats: GroupChat[];
  galleryImages: GalleryImage[];
  pointEntries: PointEntry[];
  presentations: Presentation[];
  forms: ClubForm[];
  logo: string;
  mindmap: MindMapData;
};

export const getDefaultOrgState = (): OrgState => ({
  members: [],
  donors: [],
  events: [],
  announcements: [],
  socialPosts: [],
  transactions: [],
  messages: {},
  groupChats: [],
  galleryImages: [],
  pointEntries: [],
  presentations: [],
  forms: [],
  logo: '',
  mindmap: { nodes: [], edges: [] },
});
