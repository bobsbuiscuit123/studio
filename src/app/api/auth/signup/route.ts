import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

type SignupPayload = {
  name: string;
  email: string;
  password: string;
};

const isEmail = (value: string) => /\S+@\S+\.\S+/.test(value);

export async function POST(request: Request) {
  let payload: SignupPayload;
  try {
    payload = (await request.json()) as SignupPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' });
  }

  const name = (payload.name || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  const password = payload.password || '';

  if (!name || !email || !password) {
    return NextResponse.json({ ok: false, error: 'Missing required fields.' });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ ok: false, error: 'Invalid email address.' });
  }

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) {
    const message = error.message || 'Signup failed.';
    const normalized = message.toLowerCase();
    if (normalized.includes('already') || normalized.includes('exists')) {
      return NextResponse.json({ ok: false, error: 'Email already in use.' });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId: data.user?.id });
}
