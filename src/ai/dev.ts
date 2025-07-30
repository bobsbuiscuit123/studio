import { config } from 'dotenv';
config();

import '@/ai/flows/generate-announcement.ts';
import '@/ai/flows/generate-meeting-slides.ts';
import '@/ai/flows/generate-social-media-post.ts';
import '@/ai/flows/add-calendar-event.ts';
import '@/ai/flows/send-reset-password-email.ts';
import '@/ai/flows/generate-email.ts';
import '@/ai/flows/send-bulk-email.ts';
