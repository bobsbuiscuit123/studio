'use server';

import { planAssistantTasks } from '@/ai/flows/assistant-planner';
import { generateClubAnnouncement } from '@/ai/flows/generate-announcement';
import { generateMeetingSlides } from '@/ai/flows/generate-meeting-slides';
import { addCalendarEvent } from '@/ai/flows/add-calendar-event';
import { generateEmail } from '@/ai/flows/generate-email';
import { addTransaction } from '@/ai/flows/add-transaction';
import { generateSocialMediaPost } from '@/ai/flows/generate-social-media-post';

export async function planTasksAction(query: string) {
  return planAssistantTasks({ query });
}

type TaskType =
  | 'announcement'
  | 'slides'
  | 'calendar'
  | 'email'
  | 'transaction'
  | 'social'
  | 'other';

export async function runTaskAction(
  type: TaskType,
  prompt: string
): Promise<any> {
  switch (type) {
    case 'announcement':
      return generateClubAnnouncement({ prompt });
    case 'slides':
      return generateMeetingSlides({ prompt });
    case 'calendar':
      return addCalendarEvent({ prompt });
    case 'email':
      return generateEmail({ prompt });
    case 'transaction':
      return addTransaction({ prompt });
    case 'social':
      return generateSocialMediaPost({ prompt });
    default:
      throw new Error('Task type not supported.');
  }
}
