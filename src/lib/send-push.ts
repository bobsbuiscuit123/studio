import { getMessaging } from 'firebase-admin/messaging';

import { getFirebaseAdminApp } from '@/lib/firebase-admin';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

type PushType = 'message' | 'announcement' | 'event';

type SendPushArgs = {
  userIds: string[];
  title: string;
  body: string;
  route: string;
  params?: Record<string, string>;
  type: PushType;
  entityId: string;
};

type SendPushResult = {
  requestedUserIds: number;
  tokensFound: number;
  sent: number;
  failed: number;
  disabledTokens: string[];
};

type DevicePushTokenRow = {
  id: string;
  token: string;
  user_id: string;
};

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const getErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: string }).code ?? '');
  }
  return '';
};

const isInvalidTokenError = (error: unknown) => INVALID_TOKEN_CODES.has(getErrorCode(error));

export async function sendPushToUsers({
  userIds,
  title,
  body,
  route,
  params,
  type,
  entityId,
}: SendPushArgs): Promise<SendPushResult> {
  const uniqueUserIds = Array.from(
    new Set(userIds.filter((value): value is string => typeof value === 'string' && value.length > 0))
  );

  const emptyResult: SendPushResult = {
    requestedUserIds: uniqueUserIds.length,
    tokensFound: 0,
    sent: 0,
    failed: 0,
    disabledTokens: [],
  };

  if (uniqueUserIds.length === 0) {
    return emptyResult;
  }

  try {
    const admin = createSupabaseAdmin();
    const { data, error } = await admin
      .from('device_push_tokens')
      .select('id, token, user_id')
      .in('user_id', uniqueUserIds)
      .is('disabled_at', null);

    if (error) {
      console.error('Failed to load device push tokens', error);
      return emptyResult;
    }

    const tokenRows = new Map<string, DevicePushTokenRow>();
    for (const row of (data ?? []) as DevicePushTokenRow[]) {
      if (!row.token) continue;
      tokenRows.set(row.token, row);
    }

    const activeTokens = Array.from(tokenRows.values());
    if (activeTokens.length === 0) {
      return emptyResult;
    }

    const messaging = getMessaging(getFirebaseAdminApp());
    const payload = {
      notification: { title, body },
      data: {
        route,
        params: JSON.stringify(params ?? {}),
        type,
        entityId,
      },
    };

    const results = await Promise.allSettled(
      activeTokens.map(row =>
        messaging.send({
          token: row.token,
          ...payload,
        })
      )
    );

    const invalidTokenIds: string[] = [];
    let sent = 0;
    let failed = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sent += 1;
        return;
      }

      failed += 1;
      if (isInvalidTokenError(result.reason)) {
        invalidTokenIds.push(activeTokens[index].id);
      } else {
        console.error('Push send failed', result.reason);
      }
    });

    if (invalidTokenIds.length > 0) {
      const { error: disableError } = await admin
        .from('device_push_tokens')
        .update({ disabled_at: new Date().toISOString() })
        .in('id', invalidTokenIds);
      if (disableError) {
        console.error('Failed to disable invalid push tokens', disableError);
      }
    }

    return {
      requestedUserIds: uniqueUserIds.length,
      tokensFound: activeTokens.length,
      sent,
      failed,
      disabledTokens: invalidTokenIds,
    };
  } catch (error) {
    console.error('sendPushToUsers failed', error);
    return emptyResult;
  }
}
