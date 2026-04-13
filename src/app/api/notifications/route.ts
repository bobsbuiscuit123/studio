import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { err } from '@/lib/result';

const querySchema = z.object({
  orgId: z.string().uuid().optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform(value => value === 'true'),
  limit: z
    .string()
    .optional()
    .transform(value => {
      const parsed = Number.parseInt(value ?? '25', 10);
      return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
    }),
});

const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  if (!userId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        err({ code: 'VALIDATION', message: 'Unauthorized.', source: 'app' }),
        { status: 401 }
      ),
    };
  }

  return {
    ok: true as const,
    userId,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    orgId: url.searchParams.get('orgId') ?? undefined,
    unreadOnly: url.searchParams.get('unreadOnly') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid notification request.', source: 'app' }),
      { status: 400 }
    );
  }

  const userResult = await requireUser();
  if (!userResult.ok) {
    return userResult.response;
  }

  const admin = createSupabaseAdmin();
  let query = admin
    .from('notifications')
    .select(
      'id, user_id, org_id, group_id, schema_version, type, entity_id, parent_id, parent_type, created_at, read'
    )
    .eq('user_id', userResult.userId)
    .order('created_at', { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.orgId) {
    query = query.eq('org_id', parsed.data.orgId);
  }

  if (parsed.data.unreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      notifications: data ?? [],
    },
  });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = markReadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      err({ code: 'VALIDATION', message: 'Invalid notification update.', source: 'app' }),
      { status: 400 }
    );
  }

  const userResult = await requireUser();
  if (!userResult.ok) {
    return userResult.response;
  }

  const admin = createSupabaseAdmin();
  const readAt = new Date().toISOString();
  const { error } = await admin
    .from('notifications')
    .update({ read: true, read_at: readAt })
    .eq('user_id', userResult.userId)
    .in('id', parsed.data.ids);

  if (error) {
    return NextResponse.json(
      err({ code: 'NETWORK_HTTP_ERROR', message: error.message, source: 'network' }),
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      readAt,
      ids: parsed.data.ids,
    },
  });
}
