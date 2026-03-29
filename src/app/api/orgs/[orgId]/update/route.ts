import { NextResponse } from "next/server";

import { err } from "@/lib/result";

export async function PATCH() {
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
