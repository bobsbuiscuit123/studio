import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestIp, rateLimitExceededResponse } from '@/lib/api-security';
import {
  getSignupServerErrorMessage,
  getSignupValidationMessage,
  isExistingSignupError,
  normalizeAuthEmail,
  SIGNUP_PASSWORD_MIN_LENGTH,
} from '@/lib/auth-signup';

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(SIGNUP_PASSWORD_MIN_LENGTH).max(256),
}).strict();

export async function POST(request: Request) {
  const ipLimiter = rateLimit(`auth-signup:${getRequestIp(request.headers)}`, 10, 60_000);
  if (!ipLimiter.allowed) {
    return rateLimitExceededResponse(ipLimiter);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: getSignupValidationMessage(parsed.error.issues) },
      { status: 400 }
    );
  }

  const name = parsed.data.name;
  const email = normalizeAuthEmail(parsed.data.email);
  const password = parsed.data.password;

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error) {
      const message = error.message || 'Signup failed.';
      if (isExistingSignupError(message)) {
        return NextResponse.json({ ok: false, error: 'Email already in use.' }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, userId: data.user?.id });
  } catch (error) {
    const message =
      error instanceof Error ? getSignupServerErrorMessage(error.message) : 'Signup failed.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
