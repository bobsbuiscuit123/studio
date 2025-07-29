
// This file is now primarily for defining data structures and default values,
// as the actual data will be managed by our data hooks and local storage.

export type User = {
  name: string;
  email: string;
  avatar?: string;
};

export type Member = {
  name: string;
  role: string;
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
};

export type Announcement = {
  id: number;
  title: string;
  content: string;
  author: string;
  date: string;
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
};

export type Transaction = {
  id: string;
  description: string;
  amount: number;
  date: string;
  status: 'Paid' | 'Pending';
};

export type Message = {
    id: string;
    senderEmail: string;
    recipientEmail: string;
    text: string;
    timestamp: Date;
    read: boolean;
}
