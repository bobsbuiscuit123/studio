import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = assignment.slice(0, equalsIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    let value = assignment.slice(equalsIndex + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    if (quote === '"') {
      value = value.replace(/\\n/g, "\n");
    }

    process.env[key] = value;
  }
}

loadEnvFile(".env.local");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = new Map(
  process.argv.slice(2).flatMap((arg) => {
    if (!arg.startsWith("--")) return [];
    const [key, ...rest] = arg.slice(2).split("=");
    return [[key, rest.join("=") || "true"]];
  })
);

const ownerEmail = args.get("owner-email") || process.env.DEMO_OWNER_EMAIL;
const baseOrgName = args.get("org-name") || process.env.DEMO_ORG_NAME || "Caspo Demo High School";
const freshOrg = args.get("fresh") === "true" || process.env.DEMO_FRESH_ORG === "true";
const rawOwnerGroupRole = args.get("owner-group-role") || process.env.DEMO_OWNER_GROUP_ROLE || "Admin";
const normalizedOwnerGroupRole = String(rawOwnerGroupRole).trim().toLowerCase();
const ownerGroupRole =
  normalizedOwnerGroupRole === "officer"
    ? "Officer"
    : normalizedOwnerGroupRole === "member"
      ? "Member"
      : "Admin";
const ownerGroupMembershipRole = ownerGroupRole.toLowerCase();

if (!ownerEmail) {
  console.error("Provide an owner email: npm run seed:demo-org -- --owner-email=you@example.com");
  process.exit(1);
}

const now = new Date();
const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0);
const isoDays = (offset, hour = 15, minute = 0) => {
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
};

const addDaysDate = (offset, hour = 15, minute = 0) => isoDays(offset, hour, minute);

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomCode = (length) =>
  Array.from({ length }, () => codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)]).join("");

const placeholderImage = ({ label, width = 640, height = 420, background = "#1f3529", foreground = "#86efac" }) => {
  const safeLabel = String(label || "?").slice(0, 3).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/><text x="50%" y="50%" fill="${foreground}" font-family="Arial, sans-serif" font-size="${Math.floor(Math.min(width, height) * 0.24)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

async function getOwnerProfile(email) {
  const normalizedEmail = normalizeEmail(email);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Could not look up profile: ${profileError.message}`);
  }
  if (profile?.id) {
    return {
      id: profile.id,
      email: profile.email || normalizedEmail,
      name: profile.display_name || profile.email || normalizedEmail,
    };
  }

  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError) {
    throw new Error(`Could not list auth users: ${usersError.message}`);
  }
  const authUser = users.users.find((user) => normalizeEmail(user.email) === normalizedEmail);
  if (!authUser?.id) {
    throw new Error(`No app user found for ${email}. Sign up once first, then rerun this script.`);
  }

  const name =
    authUser.user_metadata?.display_name ||
    authUser.user_metadata?.name ||
    authUser.email ||
    normalizedEmail;
  const { data: insertedProfile, error: insertProfileError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: authUser.id,
        email: authUser.email || normalizedEmail,
        display_name: name,
      },
      { onConflict: "id" }
    )
    .select("id, email, display_name")
    .maybeSingle();

  if (insertProfileError || !insertedProfile) {
    throw new Error(`Could not create profile for ${email}: ${insertProfileError?.message || "unknown error"}`);
  }

  return {
    id: insertedProfile.id,
    email: insertedProfile.email || normalizedEmail,
    name: insertedProfile.display_name || insertedProfile.email || normalizedEmail,
  };
}

async function createUniqueOrgJoinCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomCode(6);
    const { data, error } = await supabase.from("orgs").select("id").eq("join_code", code).maybeSingle();
    if (error) throw new Error(`Could not check org join code: ${error.message}`);
    if (!data) return code;
  }
  throw new Error("Could not generate a unique org join code.");
}

async function getOrCreateOrg(owner) {
  const orgName = freshOrg ? `${baseOrgName} ${new Date().toISOString().slice(0, 10)} ${randomCode(3)}` : baseOrgName;

  if (!freshOrg) {
    const { data: existingOrg, error } = await supabase
      .from("orgs")
      .select("id, name, join_code")
      .eq("owner_id", owner.id)
      .eq("name", orgName)
      .maybeSingle();
    if (error) throw new Error(`Could not look up existing demo org: ${error.message}`);
    if (existingOrg) {
      return existingOrg;
    }
  }

  const currentPeriodStart = new Date().toISOString();
  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const joinCode = await createUniqueOrgJoinCode();

  const { data: org, error } = await supabase
    .from("orgs")
    .insert({
      name: orgName,
      join_code: joinCode,
      category: "School",
      description: "Seeded demonstration organization for showing Caspo workflows with realistic club activity.",
      meeting_time: "After school",
      logo_url: placeholderImage({ label: "CD", width: 256, height: 256 }),
      created_by: owner.id,
      owner_id: owner.id,
      subscription_product_id: null,
      subscription_status: "free",
      monthly_token_limit: 0,
      tokens_used_this_period: 0,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      bonus_tokens_this_period: 0,
      ai_enabled: false,
      usage_estimate_members: 2200,
      usage_estimate_requests_per_member: 2,
      usage_estimate_monthly_tokens: 132000,
      updated_at: currentPeriodStart,
    })
    .select("id, name, join_code")
    .maybeSingle();

  if (error || !org) {
    throw new Error(`Could not create demo org: ${error?.message || "unknown error"}`);
  }

  return org;
}

async function resetOrgGroups(orgId) {
  const { data: groups, error: groupLookupError } = await supabase
    .from("groups")
    .select("id")
    .eq("org_id", orgId);
  if (groupLookupError) throw new Error(`Could not load existing groups: ${groupLookupError.message}`);

  const groupIds = (groups || []).map((group) => group.id).filter(Boolean);
  if (groupIds.length > 0) {
    await supabase.from("group_state").delete().in("group_id", groupIds);
    await supabase.from("group_memberships").delete().in("group_id", groupIds);
  }
  const { error: deleteGroupsError } = await supabase.from("groups").delete().eq("org_id", orgId);
  if (deleteGroupsError) throw new Error(`Could not clear existing groups: ${deleteGroupsError.message}`);
}

async function ensureOwnerMembership(orgId, ownerId) {
  const { error } = await supabase
    .from("memberships")
    .upsert({ org_id: orgId, user_id: ownerId, role: "owner" }, { onConflict: "user_id,org_id" });
  if (error) throw new Error(`Could not add owner membership: ${error.message}`);
}

const personas = [
  ["Ava Thompson", "ava.thompson@student.caspo.demo", "Member"],
  ["Ethan Brooks", "ethan.brooks@student.caspo.demo", "Member"],
  ["Mia Chen", "mia.chen@student.caspo.demo", "Officer"],
  ["Noah Rivera", "noah.rivera@student.caspo.demo", "Member"],
  ["Sophia Williams", "sophia.williams@student.caspo.demo", "Member"],
  ["Liam Patel", "liam.patel@student.caspo.demo", "Officer"],
  ["Isabella Nguyen", "isabella.nguyen@student.caspo.demo", "Member"],
  ["Marcus Johnson", "marcus.johnson@student.caspo.demo", "Member"],
  ["Priya Shah", "priya.shah@student.caspo.demo", "Member"],
  ["Caleb Martinez", "caleb.martinez@student.caspo.demo", "Member"],
  ["Nora Kim", "nora.kim@student.caspo.demo", "Member"],
  ["Owen Garcia", "owen.garcia@student.caspo.demo", "Member"],
];

const sponsorByClub = {
  "Robotics League": ["Dr. Priya Raman", "priya.raman@school.caspo.demo"],
  "Debate Union": ["Mr. Andre Hill", "andre.hill@school.caspo.demo"],
  "Service Squad": ["Ms. Elena Torres", "elena.torres@school.caspo.demo"],
  "Student Council": ["Mrs. Hannah Brooks", "hannah.brooks@school.caspo.demo"],
  "National Honor Society": ["Mr. Victor Chen", "victor.chen@school.caspo.demo"],
};

const clubs = [
  {
    name: "Robotics League",
    code: "RB01",
    category: "STEM",
    description: "Builds competition robots, mentors new members, and hosts engineering outreach nights.",
    color: "#164e63",
    accent: "#67e8f9",
  },
  {
    name: "Debate Union",
    code: "DB02",
    category: "Academic",
    description: "Prepares policy and public forum teams for tournaments across the district.",
    color: "#3b1d6e",
    accent: "#c4b5fd",
  },
  {
    name: "Service Squad",
    code: "SV03",
    category: "Service",
    description: "Coordinates volunteer drives, food bank shifts, and school-wide service hours.",
    color: "#14532d",
    accent: "#86efac",
  },
  {
    name: "Student Council",
    code: "SC04",
    category: "Leadership",
    description: "Plans campus events, surveys students, and coordinates class representatives.",
    color: "#7f1d1d",
    accent: "#fca5a5",
  },
  {
    name: "National Honor Society",
    code: "NH05",
    category: "Honor Society",
    description: "Tracks service hours, tutoring signups, and member recognition.",
    color: "#1e3a8a",
    accent: "#93c5fd",
  },
];

const memberSliceForClub = (clubIndex, owner) => {
  const [sponsorName, sponsorEmail] = sponsorByClub[clubs[clubIndex].name];
  const rotated = personas.slice(clubIndex * 2).concat(personas.slice(0, clubIndex * 2));
  return [
    {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      role: ownerGroupRole,
      avatar: placeholderImage({ label: owner.name.charAt(0), width: 96, height: 96 }),
    },
    {
      id: `sponsor-${clubIndex}`,
      name: sponsorName,
      email: sponsorEmail,
      role: "Admin",
      avatar: placeholderImage({ label: sponsorName.charAt(0), width: 96, height: 96 }),
    },
    ...rotated.slice(0, 9).map(([name, email, role], index) => ({
      id: `${clubs[clubIndex].code.toLowerCase()}-member-${index + 1}`,
      name,
      email,
      role,
      avatar: placeholderImage({ label: name.charAt(0), width: 96, height: 96 }),
    })),
  ];
};

const createSlides = (club, index) => [
  {
    id: `${club.code}-slide-1`,
    title: `${club.name} Monthly Priorities`,
    content: "Review attendance trends, upcoming events, and officer action items.",
  },
  {
    id: `${club.code}-slide-2`,
    title: "Member Engagement",
    content: "Focus on RSVP follow-up, recognition, and new member onboarding.",
  },
  {
    id: `${club.code}-slide-3`,
    title: "Next Steps",
    content: `Prepare ${club.category.toLowerCase()} updates before the next leadership meeting.`,
  },
];

const buildClubState = (club, index, owner) => {
  const members = memberSliceForClub(index, owner);
  const adminEmail = members[1].email;
  const officerEmail = members.find((member) => member.role === "Officer")?.email || members[2].email;
  const activeMemberEmails = members.slice(0, 7).map((member) => member.email);
  const formId = `${club.code.toLowerCase()}-member-interest-form`;
  const announcementId = 1000 + index * 10;
  const eventId = `${club.code.toLowerCase()}-weekly-sync`;

  return {
    members,
    events: [
      {
        id: eventId,
        date: addDaysDate(-5, 21, 30),
        title: `${club.name} weekly meeting`,
        description: "Officer updates, committee breakouts, and next-event planning.",
        location: index === 0 ? "Engineering Lab 214" : index === 2 ? "Community Center" : "Room 124",
        hasTime: true,
        points: 2,
        checkInCode: `${club.code}9`,
        attendees: activeMemberEmails,
        attendanceRecords: activeMemberEmails.map((email, attendeeIndex) => ({
          email,
          checkedInAt: isoDays(-5, 21, 35 + attendeeIndex),
        })),
        rsvps: {
          yes: activeMemberEmails,
          no: members.slice(8, 10).map((member) => member.email),
          maybe: members.slice(10, 11).map((member) => member.email),
        },
        rsvpRequired: true,
        viewedBy: activeMemberEmails.slice(0, 4),
        tags: ["weekly", "attendance"],
        aiTagged: index % 2 === 0,
        read: false,
      },
      {
        id: `${club.code.toLowerCase()}-showcase`,
        date: addDaysDate(4 + index, 22, 0),
        title: `${club.name} showcase night`,
        description: "Students share project updates and invite prospective members.",
        location: index === 1 ? "Off-campus Tournament Center" : "Auditorium",
        hasTime: true,
        points: 3,
        checkInCode: `${club.code}7`,
        attendees: [],
        attendanceRecords: [],
        rsvps: {
          yes: members.slice(0, 5).map((member) => member.email),
          no: [],
          maybe: members.slice(5, 8).map((member) => member.email),
        },
        rsvpRequired: true,
        viewedBy: [],
        tags: ["showcase"],
        read: false,
      },
    ],
    announcements: [
      {
        id: announcementId,
        title: `${club.name} weekly update`,
        content:
          "Please review the agenda, RSVP for the next event, and check your committee assignment before Friday.",
        author: adminEmail,
        date: isoDays(-6, 15, 15),
        read: false,
        recipients: members.map((member) => member.email),
        viewedBy: members.slice(0, 6).map((member) => member.email),
        tags: ["weekly", "action-needed"],
        aiTagged: true,
        linkedFormId: formId,
      },
      {
        id: announcementId + 1,
        title: "Officer notes posted",
        content:
          "Officer meeting notes are available. Committee leads should update their progress before the next check-in.",
        author: officerEmail,
        date: isoDays(-2, 20, 45),
        read: false,
        recipients: members.map((member) => member.email),
        viewedBy: members.slice(0, 4).map((member) => member.email),
        tags: ["officers"],
        slides: createSlides(club, index),
      },
    ],
    socialPosts: [
      {
        id: 2000 + index * 10,
        title: `${club.name} recap`,
        content: "Photos and highlights from this week's meeting. Great energy from new members.",
        images: [
          placeholderImage({ label: club.code, width: 800, height: 540, background: club.color, foreground: club.accent }),
        ],
        author: officerEmail,
        date: isoDays(-3, 19, 0),
        likes: 14 + index * 3,
        liked: false,
        comments: [
          { author: members[3].email, text: "This was really helpful." },
          { author: members[4].email, text: "Excited for the showcase." },
        ],
        read: false,
      },
    ],
    transactions: [
      {
        id: `${club.code.toLowerCase()}-txn-1`,
        description: `${club.name} fundraiser deposit`,
        amount: 320 + index * 45,
        date: isoDays(-12, 18, 0),
        status: "Deposit",
      },
      {
        id: `${club.code.toLowerCase()}-txn-2`,
        description: "Supplies and event materials",
        amount: -74 - index * 12,
        date: isoDays(-4, 17, 30),
        status: "Withdrawal",
      },
    ],
    messages: {
      [officerEmail]: [
        {
          sender: officerEmail,
          text: "Can you review the attendance list before tomorrow?",
          timestamp: isoDays(-1, 22, 15),
          readBy: [owner.email],
        },
      ],
      [members[3].email]: [
        {
          sender: members[3].email,
          text: "I uploaded the event photos and tagged the album.",
          timestamp: isoDays(-2, 21, 5),
          readBy: [],
        },
      ],
    },
    groupChats: [
      {
        id: `${club.code.toLowerCase()}-officers`,
        name: "Officer Room",
        members: [owner.email, adminEmail, officerEmail],
        messages: [
          {
            sender: adminEmail,
            text: "Please finalize committee assignments by Thursday.",
            timestamp: isoDays(-2, 16, 30),
            readBy: [adminEmail],
          },
          {
            sender: officerEmail,
            text: "I can handle reminders and attendance follow-up.",
            timestamp: isoDays(-1, 14, 10),
            readBy: [officerEmail],
          },
        ],
      },
      {
        id: `${club.code.toLowerCase()}-general`,
        name: "General Chat",
        members: members.slice(0, 8).map((member) => member.email),
        messages: [
          {
            sender: members[4].email,
            text: "What time should volunteers arrive for setup?",
            timestamp: isoDays(-1, 18, 45),
            readBy: [members[4].email],
          },
        ],
      },
    ],
    galleryImages: [
      {
        id: 3000 + index * 10,
        src: placeholderImage({ label: `${club.code} 1`, width: 900, height: 620, background: club.color, foreground: club.accent }),
        alt: `${club.name} meeting highlight`,
        author: members[5].email,
        date: isoDays(-4, 18, 0),
        likes: 18 + index,
        likedBy: members.slice(0, 4).map((member) => member.email),
        status: "approved",
        read: false,
      },
      {
        id: 3001 + index * 10,
        src: placeholderImage({ label: `${club.code} 2`, width: 900, height: 620, background: "#26352d", foreground: "#bbf7d0" }),
        alt: `${club.name} event setup`,
        author: members[6].email,
        date: isoDays(-1, 20, 0),
        likes: 7 + index,
        likedBy: [],
        status: "pending",
        read: false,
      },
    ],
    pointEntries: members.slice(2, 8).map((member, pointIndex) => ({
      id: `${club.code.toLowerCase()}-pts-${pointIndex + 1}`,
      memberEmail: member.email,
      points: 2 + (pointIndex % 3),
      reason: pointIndex % 2 === 0 ? "Event setup and cleanup" : "Committee planning support",
      date: isoDays(-pointIndex - 1, 17, 0),
      awardedBy: adminEmail,
    })),
    presentations: [
      {
        id: 4000 + index,
        prompt: `Create a ${club.name} monthly meeting deck`,
        slides: createSlides(club, index),
        createdAt: isoDays(-7, 16, 0),
      },
    ],
    forms: [
      {
        id: formId,
        title: `${club.name} Member Interest Form`,
        description: "Collect committee preferences and availability for upcoming events.",
        questions: [
          { id: "q1", prompt: "Which committee are you most interested in?", required: true, kind: "single", options: ["Events", "Outreach", "Finance", "Media"] },
          { id: "q2", prompt: "What days can you attend after school?", required: true, kind: "multi", options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
          { id: "q3", prompt: "Anything officers should know?", required: false, kind: "shortText" },
        ],
        createdBy: adminEmail,
        createdAt: isoDays(-8, 15, 45),
        viewedBy: members.slice(0, 6).map((member) => member.email),
        responses: members.slice(2, 7).map((member, responseIndex) => ({
          id: `${formId}-response-${responseIndex + 1}`,
          respondentEmail: member.email,
          submittedAt: isoDays(-7 + responseIndex, 19, 20),
          answers: {
            q1: ["Events", "Outreach", "Finance", "Media"][responseIndex % 4],
            q2: responseIndex % 2 === 0 ? "Tuesday, Thursday" : "Monday, Wednesday",
            q3: responseIndex % 2 === 0 ? "Happy to help with setup." : "Can bring a laptop.",
          },
        })),
        linkedAnnouncementId: announcementId,
      },
    ],
    logo: placeholderImage({ label: club.code, width: 256, height: 256, background: club.color, foreground: club.accent }),
    mindmap: {
      nodes: [
        {
          id: `${club.code}-root`,
          type: "input",
          position: { x: 260, y: 20 },
          data: { label: `${club.name} Plan` },
        },
        {
          id: `${club.code}-events`,
          position: { x: 60, y: 160 },
          data: { label: "Events" },
        },
        {
          id: `${club.code}-members`,
          position: { x: 260, y: 160 },
          data: { label: "Member Growth" },
        },
        {
          id: `${club.code}-budget`,
          position: { x: 460, y: 160 },
          data: { label: "Budget" },
        },
      ],
      edges: [
        { id: `${club.code}-edge-1`, source: `${club.code}-root`, target: `${club.code}-events` },
        { id: `${club.code}-edge-2`, source: `${club.code}-root`, target: `${club.code}-members` },
        { id: `${club.code}-edge-3`, source: `${club.code}-root`, target: `${club.code}-budget` },
      ],
    },
  };
};

async function seedGroup(orgId, owner, club, index) {
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({
      org_id: orgId,
      name: club.name,
      type: club.category.toLowerCase().replace(/\s+/g, "-"),
      description: club.description,
      join_code: club.code,
      created_by: owner.id,
    })
    .select("id, name, join_code")
    .maybeSingle();

  if (groupError || !group) {
    throw new Error(`Could not create group ${club.name}: ${groupError?.message || "unknown error"}`);
  }

  const { error: membershipError } = await supabase
    .from("group_memberships")
    .upsert(
      {
        org_id: orgId,
        group_id: group.id,
        user_id: owner.id,
        role: ownerGroupMembershipRole,
      },
      { onConflict: "user_id,group_id" }
    );
  if (membershipError) {
    throw new Error(`Could not create group membership for ${club.name}: ${membershipError.message}`);
  }

  const { error: stateError } = await supabase.from("group_state").insert({
    org_id: orgId,
    group_id: group.id,
    data: buildClubState(club, index, owner),
    updated_at: new Date().toISOString(),
  });
  if (stateError) {
    throw new Error(`Could not seed group state for ${club.name}: ${stateError.message}`);
  }

  return group;
}

async function run() {
  const owner = await getOwnerProfile(ownerEmail);
  const org = await getOrCreateOrg(owner);
  await ensureOwnerMembership(org.id, owner.id);
  await resetOrgGroups(org.id);

  const seededGroups = [];
  for (let index = 0; index < clubs.length; index += 1) {
    seededGroups.push(await seedGroup(org.id, owner, clubs[index], index));
  }

  console.log("");
  console.log("Seeded demo org");
  console.log(`Org: ${org.name}`);
  console.log(`Org ID: ${org.id}`);
  console.log(`Org join code: ${org.join_code}`);
  console.log(`Owner: ${owner.name} <${owner.email}>`);
  console.log("");
  console.log("Groups:");
  seededGroups.forEach((group) => {
    console.log(`- ${group.name} (${group.join_code})`);
  });
  console.log("");
  console.log("Open the app, log in as the owner above, then select this organization.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
