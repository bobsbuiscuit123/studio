import { NextResponse } from "next/server";

import { err } from "@/lib/result";
import { rateLimit } from "@/lib/rate-limit";
import { getRequestIp, rateLimitExceededResponse } from "@/lib/api-security";

export async function PATCH(request: Request) {
  const limiter = rateLimit(`org-update-retired:${getRequestIp(request.headers)}`, 15, 60_000);
  if (!limiter.allowed) {
    return rateLimitExceededResponse(limiter);
  }

  return NextResponse.json(
    err({
      code: "VALIDATION",
      message:
        "Organization runtime limits are no longer edited here. Subscription state and usage are managed through organization billing.",
      source: "app",
    }),
    { status: 410 }
  );
}
