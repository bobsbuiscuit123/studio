

export type User = {
  name: string;
  email: string;
  password?: string;
  avatar?: string;
};

export type Member = {
  id?: string;
  name: string;
  role: 'Admin' | 'Officer' | 'Member';
  avatar: string;
  email: string;
  dataAiHint?: string;
};

export type ViewReceipt = {
  email: string;
  viewedAt: string;
};

export type RSVPRecord = {
  yes: string[];
  no: string[];
  maybe?: string[];
};

export type FormQuestion = {
  id: string;
  prompt: string;
  required?: boolean;
  kind?: 'shortText' | 'single' | 'multi' | 'file';
  options?: string[];
};

export type FormResponse = {
  id: string;
  respondentEmail: string;
  submittedAt: string;
  answers: Record<string, string>;
};

export type ClubForm = {
  id: string;
  title: string;
  description?: string;
  questions: FormQuestion[];
  createdBy: string;
  createdAt: string;
  viewedBy: string[];
  responses: FormResponse[];
  linkedAnnouncementId?: number;
};

export type ClubEvent = {
  id: string;
  date: Date;
  title: string;
  description: string;
  location: string;
  hasTime?: boolean;
  points?: number;
  checkInCode?: string;
  attendees?: string[];
  attendanceRecords?: Array<{
    email: string;
    checkedInAt: string;
  }>;
  lastViewedAttendees?: number;
  rsvps?: RSVPRecord;
  rsvpRequired?: boolean;
  viewedBy?: string[];
  recipients?: string[];
  tags?: string[];
  aiTagged?: boolean;
  read?: boolean;
};

export type PointEntry = {
  id: string;
  memberEmail: string;
  points: number;
  reason: string;
  date: string;
  awardedBy: string;
};

export type Slide = {
    id: string;
    title: string;
    content: string;
}

export type Presentation = {
    id: number;
    prompt: string;
    slides: Slide[];
    createdAt: string;
}

export type Attachment = {
  name: string;
  dataUri: string;
  type: string;
};

export type Announcement = {
  id: number;
  title: string;
  content: string;
  author: string;
  date: string;
  read: boolean;
  recipients?: string[];
  viewedBy?: string[];
  tags?: string[];
  aiTagged?: boolean;
  slides?: Slide[];
  attachments?: Attachment[];
  linkedFormId?: string;
};

export type Comment = {
  author: string;
  text: string;
};

export type SocialPost = {
  id: number;
  title: string;
  content: string;
  images: string[];
  dataAiHint?: string;
  author: string;
  date: string;
  likes: number;
  liked?: boolean;
  comments: Comment[];
  read: boolean;
};

export type Transaction = {
  id: string;
  description: string;
  amount: number;
  date: string;
  status: 'Deposit' | 'Withdrawal';
};

export type GalleryImage = {
  id: number;
  src: string;
  alt: string;
  author: string;
  date: string;
  likes: number;
  likedBy?: string[];
  status: 'pending' | 'approved';
  read?: boolean;
};

export type Message = {
    id?: string;
    sender: string;
    text: string;
    timestamp: string;
    readBy: string[];
}

export type GroupChat = {
    id: string;
    name: string;
    members: string[];
    messages: Message[];
}

export type MindMapNode = {
    id: string;
    position: { x: number; y: number };
    data: { label: string };
    type?: string;
};

export type MindMapEdge = {
    id: string;
    source: string;
    target: string;
};

export type MindMapData = {
    nodes: MindMapNode[];
    edges: MindMapEdge[];
};
