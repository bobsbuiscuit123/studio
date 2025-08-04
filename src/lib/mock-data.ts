

// This file is now primarily for defining data structures and default values,
// as the actual data will be managed by our data hooks and local storage.

export type User = {
  name: string;
  email: string;
  password?: string; // Added for authentication
  avatar?: string;
};

export type Member = {
  name: string;
  role: 'President' | 'Admin' | 'Officer' | 'Member';
  avatar: string;
  email: string;
  dataAiHint?: string;
};

export type ClubEvent = {
  id: string;
  date: Date;
  title: string;
  description: string;
  location: string;
  checkInCode?: string;
  attendees?: string[]; // Array of member emails
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
  slides?: Slide[];
  attachments?: Attachment[];
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
  status: 'Paid' | 'Pending';
};

export type GalleryImage = {
  id: number;
  src: string;
  alt: string;
  author: string;
  date: string;
  likes: number;
  liked: boolean;
  status: 'pending' | 'approved';
};

export type Message = {
    sender: string; // email
    senderName: string;
    text: string;
    timestamp: string; // ISO string
    read: boolean;
}

export type GroupChat = {
    id: string;
    name: string;
    avatar?: string;
    members: string[]; // array of emails
    messages: Message[];
}

    