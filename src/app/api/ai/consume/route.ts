import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { generateClubAnnouncement } from '@/ai/flows/generate-announcement';
import { generateClubForm } from '@/ai/flows/generate-form';
import { runAssistant } from '@/ai/flows/assistant';
import { generateMessage } from '@/ai/flows/generate-message';
import { generateGalleryDescription } from '@/ai/flows/generate-gallery-description';
import { addCalendarEvent } from '@/ai/flows/add-calendar-event';
import { generateEmail } from '@/ai/flows/generate-email';
import { addTransaction } from '@/ai/flows/add-transaction';
import { generateSocialMediaPost } from '@/ai/flows/generate-social-media-post';
import { generateMeetingSlides } from '@/ai/flows/generate-meeting-slides';
import { resolveAnnouncementRecipients } from '@/ai/flows/resolve-announcement-recipients';
import { resolveInsightRequest } from '@/ai/flows/resolve-insight-request';
import { resolveMetricValue } from '@/ai/flows/resolve-metric-value';
import { resolveGraphRequest } from '@/ai/flows/resolve-graph-request';
import { resolveMissedActivity } from '@/ai/flows/resolve-missed-activity';

const schema = z.object({
  orgId: z.string().uuid().optional(),
  feature: z.enum(['chat', 'insights', 'whats_new']),
  action: z.string().optional(),
  payload: z.unknown().optional(),
});

const jsonHeaders = { 'Content-Type': 'application/json' } as const;

const successResponse = (result: unknown, status = 200) => {
  if (!result) {
    return new Response(
      JSON.stringify({
        error: true,
        message: 'AI returned null',
      }),
      {
        status: 500,
        headers: jsonHeaders,
      }
    );
  }

  console.log('AI RESULT:', result);
  return new Response(
    JSON.stringify({
      success: true,
      data: result,
    }),
    {
      status,
      headers: jsonHeaders,
    }
  );
};

const errorResponse = (error: unknown, status = 500) =>
  new Response(
    JSON.stringify({
      error: true,
      message:
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message || 'Unknown error')
          : 'Unknown error',
    }),
    {
      status,
      headers: jsonHeaders,
    }
  );

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    console.log('REQUEST BODY:', body);

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(new Error('Invalid AI request.'), 500);
    }

    const headerList = await headers();
    const cookieStore = await cookies();
    const orgId = parsed.data.orgId || cookieStore.get('selectedOrgId')?.value;
    const groupId = cookieStore.get('selectedGroupId')?.value;
    if (!orgId) {
      return errorResponse(new Error('Missing organization.'), 500);
    }
    if (!groupId) {
      return errorResponse(new Error('Missing group.'), 500);
    }

    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return errorResponse(new Error('Unauthorized.'), 500);
    }

    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      'unknown';
    if (!ip) {
      return errorResponse(new Error('Unknown error'), 500);
    }

    const admin = createSupabaseAdmin();
    const payload = parsed.data.payload as Record<string, unknown> | undefined;
    const feature = parsed.data.feature;
    const action = parsed.data.action || (feature === 'chat' ? 'assistant' : feature);

    const messageSource =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.query === 'string'
          ? payload.query
          : typeof payload?.prompt === 'string'
            ? payload.prompt
            : '';
    const message = String(messageSource ?? '').trim();
    console.log('MESSAGE:', message);

    let result: unknown;

    if (feature === 'chat') {
      switch (action) {
        case 'assistant':
          if (!message) {
            return errorResponse(new Error('AI returned null'), 500);
          }
          result = await runAssistant({
            query: message,
            history: Array.isArray(payload?.history)
              ? payload.history.filter(
                  (
                    item: unknown
                  ): item is { role: 'user' | 'assistant'; content: string } =>
                    Boolean(item) &&
                    typeof item === 'object' &&
                    ((item as { role?: unknown }).role === 'user' ||
                      (item as { role?: unknown }).role === 'assistant') &&
                    typeof (item as { content?: unknown }).content === 'string'
                )
              : undefined,
            orgId,
            groupId,
            userId,
          });
          break;
        case 'announcement':
          result = await generateClubAnnouncement(payload);
          break;
        case 'form':
          result = await generateClubForm(payload);
          break;
        case 'calendar':
          result = await addCalendarEvent(payload);
          break;
        case 'email':
          result = await generateEmail(payload);
          break;
        case 'messages':
          result = await generateMessage(payload);
          break;
        case 'gallery':
          result = await generateGalleryDescription(payload);
          break;
        case 'transaction':
          result = await addTransaction(payload);
          break;
        case 'social':
          result = await generateSocialMediaPost(payload);
          break;
        case 'slides':
          result = await generateMeetingSlides(payload);
          break;
        case 'announcement_recipients':
          result = await resolveAnnouncementRecipients(payload);
          break;
        case 'metric':
          result = await resolveMetricValue(payload);
          break;
        case 'graph':
          result = await resolveGraphRequest(payload);
          break;
        case 'missed_activity':
          result = await resolveMissedActivity(payload);
          break;
        default:
          return errorResponse(new Error('Unknown AI action.'), 500);
      }
    } else if (feature === 'insights') {
      result = await resolveInsightRequest(payload);
    } else {
      if (!message) {
        return errorResponse(new Error('AI returned null'), 500);
      }
      result = await runAssistant({
        query: message,
        history: undefined,
        orgId,
        groupId,
        userId,
      });
    }

    if (!result) {
      return new Response(
        JSON.stringify({
          error: true,
          message: 'AI returned null',
        }),
        {
          status: 500,
          headers: jsonHeaders,
        }
      );
    }

    console.log('AI RESULT:', result);
    return successResponse(result, 200);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: true,
        message:
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message || 'Unknown error')
            : 'Unknown error',
      }),
      {
        status: 500,
        headers: jsonHeaders,
      }
    );
  }
}
