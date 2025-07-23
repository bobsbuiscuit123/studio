import { config } from 'dotenv';
config();

import '@/ai/flows/generate-announcement.ts';
import '@/ai/flows/generate-meeting-slides.ts';
import '@/ai/flows/generate-social-media-post.ts';
import '@/ai/flows/add-calendar-event.ts';
