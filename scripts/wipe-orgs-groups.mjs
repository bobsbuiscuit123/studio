import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});

const TABLES = [
  { name: "group_state", filter: "group_id" },
  { name: "group_memberships", filter: "user_id" },
  { name: "messages", filter: "id" },
  { name: "announcements", filter: "id" },
  { name: "groups", filter: "id" },
  { name: "memberships", filter: "user_id" },
  { name: "org_billing_plans", filter: "id" },
  { name: "org_subscriptions", filter: "id" },
  { name: "org_usage_daily", filter: "id" },
  { name: "org_cache", filter: "id" },
  { name: "org_state", filter: "org_id" },
  { name: "org_state_legacy", filter: "org_id" },
  { name: "audit_logs", filter: "id" },
  { name: "orgs", filter: "id" },
];

async function deleteAll({ name, filter }) {
  const { error } = await supabase
    .from(name)
    .delete()
    .neq(filter, "00000000-0000-0000-0000-000000000000");
  if (error) {
    if (
      (error.message?.includes("relation") && error.message?.includes("does not exist")) ||
      error.message?.includes("Could not find the table")
    ) {
      console.log(`skip ${name}: missing`);
      return;
    }
    throw new Error(`${name}: ${error.message}`);
  }
  console.log(`cleared ${name}`);
}

async function run() {
  for (const table of TABLES) {
    await deleteAll(table);
  }
  console.log("done");
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
