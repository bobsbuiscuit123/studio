import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { err } from "@/lib/result";

const MAX_MEMBER_LIMIT = 10_000;
const MAX_DAILY_AI_LIMIT = 200;

const updateSchema = z.object({
  memberLimit: z.number().int().min(1).max(MAX_MEMBER_LIMIT),
  dailyAiLimitPerUser: z.number().int().min(0).max(MAX_DAILY_AI_LIMIT),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const parsedOrgId = z.string().uuid().safeParse(orgId);
  if (!parsedOrgId.success) {
    return NextResponse.json(
      err({ code: "VALIDATION", message: "Invalid org id.", source: "app" }),
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      err({ code: "VALIDATION", message: "Invalid request body.", source: "app" }),
      { status: 400 }
    );
  }

  const parsedBody = updateSchema.safeParse(body);
  if (!parsedBody.success) {
    const firstError = parsedBody.error.errors[0];
    return NextResponse.json(
      err({
        code: "VALIDATION",
        message: firstError?.message || "Invalid organization settings.",
        source: "app",
      }),
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      err({ code: "VALIDATION", message: "Unauthorized.", source: "app" }),
      { status: 401 }
    );
  }

  const admin = createSupabaseAdmin();
  const { data: membership } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", parsedOrgId.data)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      err({
        code: "VALIDATION",
        message: "Only organization owners can change these settings.",
        source: "app",
      }),
      { status: 403 }
    );
  }

  const { error } = await admin
    .from("orgs")
    .update({
      member_cap: parsedBody.data.memberLimit,
      daily_ai_limit: parsedBody.data.dailyAiLimitPerUser,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsedOrgId.data);

  if (error) {
    return NextResponse.json(
      err({ code: "NETWORK_HTTP_ERROR", message: error.message, source: "network" }),
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
