
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import '@/ai/flows/generate-announcement.ts';
import '@/ai/flows/generate-form.ts';
import '@/ai/flows/generate-meeting-slides.ts';
import '@/ai/flows/resolve-followups.ts';
import '@/ai/flows/generate-social-media-post.ts';
import '@/ai/flows/add-calendar-event.ts';
import '@/ai/flows/send-reset-password-email.ts';
import '@/ai/flows/generate-email.ts';
import '@/ai/flows/add-transaction.ts';
import '@/ai/flows/assistant.ts';
import '@/ai/flows/resolve-announcement-recipients.ts';
import '@/ai/flows/resolve-insight-request.ts';
import '@/ai/flows/resolve-metric-value.ts';
import '@/ai/flows/resolve-graph-request.ts';
import '@/ai/flows/resolve-missed-activity.ts';
