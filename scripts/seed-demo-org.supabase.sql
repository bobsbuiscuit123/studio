-- Paste this into Supabase Dashboard > SQL Editor > New query.
-- Change v_owner_email if you want the demo org to appear under a different account.

do $$
declare
  v_owner_email text := 'pratheek.mukkavilli@gmail.com';
  v_owner_id uuid;
  v_owner_name text;
  v_org_id uuid;
  v_group_id uuid;
  v_join_code text := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
begin
  select id, coalesce(raw_user_meta_data->>'display_name', raw_user_meta_data->>'name', email)
  into v_owner_id, v_owner_name
  from auth.users
  where lower(email) = lower(v_owner_email)
  limit 1;

  if v_owner_id is null then
    raise exception 'No Supabase auth user found for %. Log into the app once with that email, then rerun this SQL.', v_owner_email;
  end if;

  insert into public.profiles (id, email, display_name)
  values (v_owner_id, v_owner_email, coalesce(v_owner_name, split_part(v_owner_email, '@', 1)))
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);

  insert into public.orgs (
    name,
    join_code,
    category,
    description,
    meeting_time,
    logo_url,
    created_by,
    owner_id,
    subscription_status,
    monthly_token_limit,
    tokens_used_this_period,
    current_period_start,
    current_period_end,
    bonus_tokens_this_period,
    ai_enabled,
    usage_estimate_members,
    usage_estimate_requests_per_member,
    usage_estimate_monthly_tokens,
    updated_at
  )
  values (
    'Caspo Demo High School',
    v_join_code,
    'School',
    'Demo organization with realistic clubs, members, events, announcements, finance, gallery, forms, and points data.',
    'After school',
    null,
    v_owner_id,
    v_owner_id,
    'free',
    0,
    0,
    now(),
    now() + interval '30 days',
    0,
    false,
    2200,
    2,
    132000,
    now()
  )
  returning id into v_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (v_owner_id, v_org_id, 'owner')
  on conflict (user_id, org_id) do update set role = 'owner';

  -- Robotics League
  insert into public.groups (org_id, name, type, description, join_code, created_by)
  values (
    v_org_id,
    'Robotics League',
    'stem',
    'Builds competition robots, mentors new members, and hosts engineering outreach nights.',
    'RB01',
    v_owner_id
  )
  returning id into v_group_id;

  insert into public.group_memberships (org_id, group_id, user_id, role)
  values (v_org_id, v_group_id, v_owner_id, 'admin')
  on conflict (user_id, group_id) do update set role = 'admin';

  insert into public.group_state (org_id, group_id, data, updated_at)
  values (
    v_org_id,
    v_group_id,
    jsonb_build_object(
      'members', jsonb_build_array(
        jsonb_build_object('id', v_owner_id::text, 'name', coalesce(v_owner_name, 'Demo Owner'), 'email', v_owner_email, 'role', 'Admin'),
        jsonb_build_object('id', 'robotics-sponsor', 'name', 'Dr. Priya Raman', 'email', 'priya.raman@school.caspo.demo', 'role', 'Admin'),
        jsonb_build_object('id', 'robotics-1', 'name', 'Mia Chen', 'email', 'mia.chen@student.caspo.demo', 'role', 'Officer'),
        jsonb_build_object('id', 'robotics-2', 'name', 'Ava Thompson', 'email', 'ava.thompson@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'robotics-3', 'name', 'Noah Rivera', 'email', 'noah.rivera@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'robotics-4', 'name', 'Ethan Brooks', 'email', 'ethan.brooks@student.caspo.demo', 'role', 'Member')
      ),
      'events', jsonb_build_array(
        jsonb_build_object(
          'id', 'robotics-weekly-sync',
          'title', 'Robotics League weekly meeting',
          'description', 'Drive-team practice, CAD review, and outreach planning.',
          'date', (now() - interval '5 days')::text,
          'location', 'Engineering Lab 214',
          'hasTime', true,
          'points', 2,
          'checkInCode', 'RB019',
          'attendees', jsonb_build_array(v_owner_email, 'priya.raman@school.caspo.demo', 'mia.chen@student.caspo.demo', 'ava.thompson@student.caspo.demo'),
          'attendanceRecords', jsonb_build_array(
            jsonb_build_object('email', v_owner_email, 'checkedInAt', (now() - interval '5 days' + interval '5 minutes')::text),
            jsonb_build_object('email', 'mia.chen@student.caspo.demo', 'checkedInAt', (now() - interval '5 days' + interval '7 minutes')::text)
          ),
          'rsvps', jsonb_build_object('yes', jsonb_build_array(v_owner_email, 'mia.chen@student.caspo.demo', 'ava.thompson@student.caspo.demo'), 'no', jsonb_build_array(), 'maybe', jsonb_build_array('noah.rivera@student.caspo.demo')),
          'aiTagged', true
        ),
        jsonb_build_object(
          'id', 'robotics-showcase',
          'title', 'Robot showcase night',
          'description', 'Students demonstrate this season''s robot for families and sponsors.',
          'date', (now() + interval '4 days')::text,
          'location', 'Auditorium',
          'hasTime', true,
          'points', 3,
          'attendees', jsonb_build_array(),
          'attendanceRecords', jsonb_build_array()
        )
      ),
      'announcements', jsonb_build_array(
        jsonb_build_object(
          'id', 101,
          'title', 'Build season update',
          'content', 'Please review the parts checklist, RSVP for showcase night, and upload subsystem notes before Friday.',
          'author', 'priya.raman@school.caspo.demo',
          'date', (now() - interval '3 days')::text,
          'viewedBy', jsonb_build_array(v_owner_email, 'mia.chen@student.caspo.demo', 'ava.thompson@student.caspo.demo'),
          'aiTagged', true
        )
      ),
      'pointEntries', jsonb_build_array(
        jsonb_build_object('id', 'rb-points-1', 'memberEmail', 'mia.chen@student.caspo.demo', 'points', 4, 'reason', 'Drive practice setup', 'date', (now() - interval '4 days')::text, 'awardedBy', 'priya.raman@school.caspo.demo'),
        jsonb_build_object('id', 'rb-points-2', 'memberEmail', 'ava.thompson@student.caspo.demo', 'points', 3, 'reason', 'CAD review', 'date', (now() - interval '2 days')::text, 'awardedBy', 'priya.raman@school.caspo.demo')
      ),
      'transactions', jsonb_build_array(
        jsonb_build_object('id', 'rb-txn-1', 'description', 'Fundraiser deposit', 'amount', 480, 'date', (now() - interval '10 days')::text, 'status', 'Deposit'),
        jsonb_build_object('id', 'rb-txn-2', 'description', 'Servo motors and wiring', 'amount', -126, 'date', (now() - interval '2 days')::text, 'status', 'Withdrawal')
      ),
      'galleryImages', jsonb_build_array(
        jsonb_build_object('id', 301, 'src', 'https://placehold.co/900x620/164e63/67e8f9?text=Robotics', 'alt', 'Robotics lab demo', 'author', 'mia.chen@student.caspo.demo', 'date', (now() - interval '2 days')::text, 'likes', 18, 'status', 'approved')
      ),
      'forms', jsonb_build_array(
        jsonb_build_object(
          'id', 'robotics-interest',
          'title', 'Robotics committee preferences',
          'description', 'Collect subsystem and meeting availability preferences.',
          'questions', jsonb_build_array(
            jsonb_build_object('id', 'q1', 'prompt', 'Which subsystem are you most interested in?', 'required', true, 'kind', 'single', 'options', jsonb_build_array('Drive', 'CAD', 'Programming', 'Outreach')),
            jsonb_build_object('id', 'q2', 'prompt', 'Which days can you attend build sessions?', 'required', true, 'kind', 'multi', 'options', jsonb_build_array('Monday', 'Tuesday', 'Wednesday', 'Thursday'))
          ),
          'createdBy', 'priya.raman@school.caspo.demo',
          'createdAt', (now() - interval '7 days')::text,
          'viewedBy', jsonb_build_array(v_owner_email, 'mia.chen@student.caspo.demo'),
          'responses', jsonb_build_array(
            jsonb_build_object('id', 'robotics-interest-response-1', 'respondentEmail', 'mia.chen@student.caspo.demo', 'submittedAt', (now() - interval '6 days')::text, 'answers', jsonb_build_object('q1', 'Programming', 'q2', 'Tuesday, Thursday'))
          )
        )
      ),
      'messages', jsonb_build_object(),
      'groupChats', jsonb_build_array(),
      'socialPosts', jsonb_build_array(),
      'presentations', jsonb_build_array(),
      'mindmap', jsonb_build_object('nodes', jsonb_build_array(), 'edges', jsonb_build_array())
    ),
    now()
  );

  -- Debate Union
  insert into public.groups (org_id, name, type, description, join_code, created_by)
  values (
    v_org_id,
    'Debate Union',
    'academic',
    'Prepares policy and public forum teams for tournaments across the district.',
    'DB02',
    v_owner_id
  )
  returning id into v_group_id;

  insert into public.group_memberships (org_id, group_id, user_id, role)
  values (v_org_id, v_group_id, v_owner_id, 'admin')
  on conflict (user_id, group_id) do update set role = 'admin';

  insert into public.group_state (org_id, group_id, data, updated_at)
  values (
    v_org_id,
    v_group_id,
    jsonb_build_object(
      'members', jsonb_build_array(
        jsonb_build_object('id', v_owner_id::text, 'name', coalesce(v_owner_name, 'Demo Owner'), 'email', v_owner_email, 'role', 'Admin'),
        jsonb_build_object('id', 'debate-sponsor', 'name', 'Mr. Andre Hill', 'email', 'andre.hill@school.caspo.demo', 'role', 'Admin'),
        jsonb_build_object('id', 'debate-1', 'name', 'Liam Patel', 'email', 'liam.patel@student.caspo.demo', 'role', 'Officer'),
        jsonb_build_object('id', 'debate-2', 'name', 'Sophia Williams', 'email', 'sophia.williams@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'debate-3', 'name', 'Marcus Johnson', 'email', 'marcus.johnson@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'debate-4', 'name', 'Priya Shah', 'email', 'priya.shah@student.caspo.demo', 'role', 'Member')
      ),
      'events', jsonb_build_array(
        jsonb_build_object(
          'id', 'debate-practice',
          'title', 'Tournament prep practice',
          'description', 'Case drills, judge feedback review, and partner pairings.',
          'date', (now() - interval '8 days')::text,
          'location', 'Room 124',
          'hasTime', true,
          'points', 2,
          'attendees', jsonb_build_array('liam.patel@student.caspo.demo', 'sophia.williams@student.caspo.demo'),
          'attendanceRecords', jsonb_build_array(jsonb_build_object('email', 'liam.patel@student.caspo.demo', 'checkedInAt', (now() - interval '8 days' + interval '4 minutes')::text))
        ),
        jsonb_build_object(
          'id', 'debate-tournament',
          'title', 'District speech tournament',
          'description', 'Off-campus tournament. Travel roster needs admin review.',
          'date', (now() + interval '6 days')::text,
          'location', 'Off-campus Tournament Center',
          'hasTime', true,
          'points', 5,
          'attendees', jsonb_build_array(),
          'attendanceRecords', jsonb_build_array()
        )
      ),
      'announcements', jsonb_build_array(
        jsonb_build_object('id', 201, 'title', 'Tournament roster due', 'content', 'Upload final cases and confirm travel forms by Wednesday.', 'author', 'andre.hill@school.caspo.demo', 'date', (now() - interval '1 day')::text, 'viewedBy', jsonb_build_array('liam.patel@student.caspo.demo'))
      ),
      'pointEntries', jsonb_build_array(
        jsonb_build_object('id', 'db-points-1', 'memberEmail', 'liam.patel@student.caspo.demo', 'points', 5, 'reason', 'Practice leadership', 'date', (now() - interval '8 days')::text, 'awardedBy', 'andre.hill@school.caspo.demo')
      ),
      'transactions', jsonb_build_array(),
      'galleryImages', jsonb_build_array(),
      'forms', jsonb_build_array(),
      'messages', jsonb_build_object(),
      'groupChats', jsonb_build_array(),
      'socialPosts', jsonb_build_array(),
      'presentations', jsonb_build_array(),
      'mindmap', jsonb_build_object('nodes', jsonb_build_array(), 'edges', jsonb_build_array())
    ),
    now()
  );

  -- Service Squad
  insert into public.groups (org_id, name, type, description, join_code, created_by)
  values (
    v_org_id,
    'Service Squad',
    'service',
    'Coordinates volunteer drives, food bank shifts, and school-wide service hours.',
    'SV03',
    v_owner_id
  )
  returning id into v_group_id;

  insert into public.group_memberships (org_id, group_id, user_id, role)
  values (v_org_id, v_group_id, v_owner_id, 'admin')
  on conflict (user_id, group_id) do update set role = 'admin';

  insert into public.group_state (org_id, group_id, data, updated_at)
  values (
    v_org_id,
    v_group_id,
    jsonb_build_object(
      'members', jsonb_build_array(
        jsonb_build_object('id', v_owner_id::text, 'name', coalesce(v_owner_name, 'Demo Owner'), 'email', v_owner_email, 'role', 'Admin'),
        jsonb_build_object('id', 'service-sponsor', 'name', 'Ms. Elena Torres', 'email', 'elena.torres@school.caspo.demo', 'role', 'Admin'),
        jsonb_build_object('id', 'service-1', 'name', 'Isabella Nguyen', 'email', 'isabella.nguyen@student.caspo.demo', 'role', 'Officer'),
        jsonb_build_object('id', 'service-2', 'name', 'Caleb Martinez', 'email', 'caleb.martinez@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'service-3', 'name', 'Nora Kim', 'email', 'nora.kim@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'service-4', 'name', 'Owen Garcia', 'email', 'owen.garcia@student.caspo.demo', 'role', 'Member')
      ),
      'events', jsonb_build_array(
        jsonb_build_object(
          'id', 'service-food-bank',
          'title', 'Food bank volunteer shift',
          'description', 'Sort donations and log service hours for attendees.',
          'date', (now() - interval '3 days')::text,
          'location', 'Community Center',
          'hasTime', true,
          'points', 4,
          'attendees', jsonb_build_array('isabella.nguyen@student.caspo.demo', 'caleb.martinez@student.caspo.demo', 'nora.kim@student.caspo.demo'),
          'attendanceRecords', jsonb_build_array(
            jsonb_build_object('email', 'isabella.nguyen@student.caspo.demo', 'checkedInAt', (now() - interval '3 days' + interval '2 minutes')::text),
            jsonb_build_object('email', 'caleb.martinez@student.caspo.demo', 'checkedInAt', (now() - interval '3 days' + interval '6 minutes')::text)
          )
        )
      ),
      'announcements', jsonb_build_array(
        jsonb_build_object('id', 301, 'title', 'Service hours reminder', 'content', 'Submit your food bank reflection and verify your hours by Friday.', 'author', 'elena.torres@school.caspo.demo', 'date', (now() - interval '2 days')::text, 'viewedBy', jsonb_build_array('isabella.nguyen@student.caspo.demo', 'caleb.martinez@student.caspo.demo'), 'aiTagged', true)
      ),
      'pointEntries', jsonb_build_array(
        jsonb_build_object('id', 'sv-points-1', 'memberEmail', 'isabella.nguyen@student.caspo.demo', 'points', 4, 'reason', 'Food bank shift', 'date', (now() - interval '3 days')::text, 'awardedBy', 'elena.torres@school.caspo.demo'),
        jsonb_build_object('id', 'sv-points-2', 'memberEmail', 'caleb.martinez@student.caspo.demo', 'points', 4, 'reason', 'Food bank shift', 'date', (now() - interval '3 days')::text, 'awardedBy', 'elena.torres@school.caspo.demo')
      ),
      'transactions', jsonb_build_array(jsonb_build_object('id', 'sv-txn-1', 'description', 'Donation drive supplies', 'amount', -58, 'date', (now() - interval '6 days')::text, 'status', 'Withdrawal')),
      'galleryImages', jsonb_build_array(jsonb_build_object('id', 401, 'src', 'https://placehold.co/900x620/14532d/86efac?text=Service', 'alt', 'Service day', 'author', 'nora.kim@student.caspo.demo', 'date', (now() - interval '2 days')::text, 'likes', 12, 'status', 'approved')),
      'forms', jsonb_build_array(),
      'messages', jsonb_build_object(),
      'groupChats', jsonb_build_array(),
      'socialPosts', jsonb_build_array(),
      'presentations', jsonb_build_array(),
      'mindmap', jsonb_build_object('nodes', jsonb_build_array(), 'edges', jsonb_build_array())
    ),
    now()
  );

  -- Student Council
  insert into public.groups (org_id, name, type, description, join_code, created_by)
  values (
    v_org_id,
    'Student Council',
    'leadership',
    'Plans campus events, surveys students, and coordinates class representatives.',
    'SC04',
    v_owner_id
  )
  returning id into v_group_id;

  insert into public.group_memberships (org_id, group_id, user_id, role)
  values (v_org_id, v_group_id, v_owner_id, 'admin')
  on conflict (user_id, group_id) do update set role = 'admin';

  insert into public.group_state (org_id, group_id, data, updated_at)
  values (
    v_org_id,
    v_group_id,
    jsonb_build_object(
      'members', jsonb_build_array(
        jsonb_build_object('id', v_owner_id::text, 'name', coalesce(v_owner_name, 'Demo Owner'), 'email', v_owner_email, 'role', 'Admin'),
        jsonb_build_object('id', 'stuco-sponsor', 'name', 'Mrs. Hannah Brooks', 'email', 'hannah.brooks@school.caspo.demo', 'role', 'Admin'),
        jsonb_build_object('id', 'stuco-1', 'name', 'Owen Garcia', 'email', 'owen.garcia@student.caspo.demo', 'role', 'Officer'),
        jsonb_build_object('id', 'stuco-2', 'name', 'Ava Thompson', 'email', 'ava.thompson@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'stuco-3', 'name', 'Marcus Johnson', 'email', 'marcus.johnson@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'stuco-4', 'name', 'Nora Kim', 'email', 'nora.kim@student.caspo.demo', 'role', 'Member')
      ),
      'events', jsonb_build_array(
        jsonb_build_object(
          'id', 'stuco-planning',
          'title', 'Spring festival planning',
          'description', 'Vendor layout, volunteer assignments, and announcement schedule.',
          'date', (now() - interval '2 days')::text,
          'location', 'Leadership Room',
          'hasTime', true,
          'points', 2,
          'attendees', jsonb_build_array('owen.garcia@student.caspo.demo', 'ava.thompson@student.caspo.demo', 'marcus.johnson@student.caspo.demo'),
          'attendanceRecords', jsonb_build_array(jsonb_build_object('email', 'owen.garcia@student.caspo.demo', 'checkedInAt', (now() - interval '2 days' + interval '3 minutes')::text))
        ),
        jsonb_build_object(
          'id', 'stuco-townhall',
          'title', 'Student feedback town hall',
          'description', 'Collect student feedback for next month''s campus priorities.',
          'date', (now() + interval '9 days')::text,
          'location', 'Library Commons',
          'hasTime', true,
          'points', 2,
          'attendees', jsonb_build_array(),
          'attendanceRecords', jsonb_build_array()
        )
      ),
      'announcements', jsonb_build_array(
        jsonb_build_object('id', 401, 'title', 'Festival volunteer slots open', 'content', 'Sign up for setup, welcome table, or cleanup shifts by Thursday.', 'author', 'hannah.brooks@school.caspo.demo', 'date', (now() - interval '1 day')::text, 'viewedBy', jsonb_build_array('owen.garcia@student.caspo.demo', 'ava.thompson@student.caspo.demo'), 'aiTagged', true)
      ),
      'pointEntries', jsonb_build_array(
        jsonb_build_object('id', 'sc-points-1', 'memberEmail', 'owen.garcia@student.caspo.demo', 'points', 3, 'reason', 'Festival planning lead', 'date', (now() - interval '2 days')::text, 'awardedBy', 'hannah.brooks@school.caspo.demo')
      ),
      'transactions', jsonb_build_array(jsonb_build_object('id', 'sc-txn-1', 'description', 'Festival decorations', 'amount', -92, 'date', (now() - interval '3 days')::text, 'status', 'Withdrawal')),
      'galleryImages', jsonb_build_array(jsonb_build_object('id', 501, 'src', 'https://placehold.co/900x620/7f1d1d/fca5a5?text=Student+Council', 'alt', 'Student council planning', 'author', 'ava.thompson@student.caspo.demo', 'date', (now() - interval '1 day')::text, 'likes', 15, 'status', 'approved')),
      'forms', jsonb_build_array(jsonb_build_object(
        'id', 'stuco-volunteer-form',
        'title', 'Festival volunteer signup',
        'description', 'Collect volunteer shift preferences.',
        'questions', jsonb_build_array(
          jsonb_build_object('id', 'q1', 'prompt', 'Which shift can you cover?', 'required', true, 'kind', 'single', 'options', jsonb_build_array('Setup', 'Welcome table', 'Cleanup')),
          jsonb_build_object('id', 'q2', 'prompt', 'Any equipment you can bring?', 'required', false, 'kind', 'shortText')
        ),
        'createdBy', 'hannah.brooks@school.caspo.demo',
        'createdAt', (now() - interval '4 days')::text,
        'viewedBy', jsonb_build_array('owen.garcia@student.caspo.demo'),
        'responses', jsonb_build_array(
          jsonb_build_object('id', 'stuco-volunteer-response-1', 'respondentEmail', 'owen.garcia@student.caspo.demo', 'submittedAt', (now() - interval '3 days')::text, 'answers', jsonb_build_object('q1', 'Setup', 'q2', 'Extension cords'))
        )
      )),
      'messages', jsonb_build_object(),
      'groupChats', jsonb_build_array(),
      'socialPosts', jsonb_build_array(),
      'presentations', jsonb_build_array(),
      'mindmap', jsonb_build_object('nodes', jsonb_build_array(), 'edges', jsonb_build_array())
    ),
    now()
  );

  -- National Honor Society
  insert into public.groups (org_id, name, type, description, join_code, created_by)
  values (
    v_org_id,
    'National Honor Society',
    'honor-society',
    'Tracks service hours, tutoring signups, and member recognition.',
    'NH05',
    v_owner_id
  )
  returning id into v_group_id;

  insert into public.group_memberships (org_id, group_id, user_id, role)
  values (v_org_id, v_group_id, v_owner_id, 'admin')
  on conflict (user_id, group_id) do update set role = 'admin';

  insert into public.group_state (org_id, group_id, data, updated_at)
  values (
    v_org_id,
    v_group_id,
    jsonb_build_object(
      'members', jsonb_build_array(
        jsonb_build_object('id', v_owner_id::text, 'name', coalesce(v_owner_name, 'Demo Owner'), 'email', v_owner_email, 'role', 'Admin'),
        jsonb_build_object('id', 'nhs-sponsor', 'name', 'Mr. Victor Chen', 'email', 'victor.chen@school.caspo.demo', 'role', 'Admin'),
        jsonb_build_object('id', 'nhs-1', 'name', 'Priya Shah', 'email', 'priya.shah@student.caspo.demo', 'role', 'Officer'),
        jsonb_build_object('id', 'nhs-2', 'name', 'Sophia Williams', 'email', 'sophia.williams@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'nhs-3', 'name', 'Ethan Brooks', 'email', 'ethan.brooks@student.caspo.demo', 'role', 'Member'),
        jsonb_build_object('id', 'nhs-4', 'name', 'Caleb Martinez', 'email', 'caleb.martinez@student.caspo.demo', 'role', 'Member')
      ),
      'events', jsonb_build_array(
        jsonb_build_object(
          'id', 'nhs-tutoring',
          'title', 'Peer tutoring lab',
          'description', 'Math and science tutoring with hour verification.',
          'date', (now() - interval '6 days')::text,
          'location', 'Media Center',
          'hasTime', true,
          'points', 3,
          'attendees', jsonb_build_array('priya.shah@student.caspo.demo', 'sophia.williams@student.caspo.demo', 'ethan.brooks@student.caspo.demo'),
          'attendanceRecords', jsonb_build_array(
            jsonb_build_object('email', 'priya.shah@student.caspo.demo', 'checkedInAt', (now() - interval '6 days' + interval '5 minutes')::text),
            jsonb_build_object('email', 'sophia.williams@student.caspo.demo', 'checkedInAt', (now() - interval '6 days' + interval '8 minutes')::text)
          )
        )
      ),
      'announcements', jsonb_build_array(
        jsonb_build_object('id', 501, 'title', 'Service log deadline', 'content', 'Tutoring and service entries must be verified before the monthly officer review.', 'author', 'victor.chen@school.caspo.demo', 'date', (now() - interval '2 days')::text, 'viewedBy', jsonb_build_array('priya.shah@student.caspo.demo', 'sophia.williams@student.caspo.demo'), 'aiTagged', true)
      ),
      'pointEntries', jsonb_build_array(
        jsonb_build_object('id', 'nh-points-1', 'memberEmail', 'priya.shah@student.caspo.demo', 'points', 3, 'reason', 'Peer tutoring', 'date', (now() - interval '6 days')::text, 'awardedBy', 'victor.chen@school.caspo.demo'),
        jsonb_build_object('id', 'nh-points-2', 'memberEmail', 'sophia.williams@student.caspo.demo', 'points', 3, 'reason', 'Peer tutoring', 'date', (now() - interval '6 days')::text, 'awardedBy', 'victor.chen@school.caspo.demo')
      ),
      'transactions', jsonb_build_array(),
      'galleryImages', jsonb_build_array(),
      'forms', jsonb_build_array(jsonb_build_object(
        'id', 'nhs-hours-form',
        'title', 'Service hour verification',
        'description', 'Submit tutoring and service hour proof.',
        'questions', jsonb_build_array(
          jsonb_build_object('id', 'q1', 'prompt', 'How many hours did you complete?', 'required', true, 'kind', 'shortText'),
          jsonb_build_object('id', 'q2', 'prompt', 'Who verified your service?', 'required', true, 'kind', 'shortText')
        ),
        'createdBy', 'victor.chen@school.caspo.demo',
        'createdAt', (now() - interval '5 days')::text,
        'viewedBy', jsonb_build_array('priya.shah@student.caspo.demo'),
        'responses', jsonb_build_array(
          jsonb_build_object('id', 'nhs-hours-response-1', 'respondentEmail', 'priya.shah@student.caspo.demo', 'submittedAt', (now() - interval '4 days')::text, 'answers', jsonb_build_object('q1', '3', 'q2', 'Mr. Chen'))
        )
      )),
      'messages', jsonb_build_object(),
      'groupChats', jsonb_build_array(),
      'socialPosts', jsonb_build_array(),
      'presentations', jsonb_build_array(),
      'mindmap', jsonb_build_object('nodes', jsonb_build_array(), 'edges', jsonb_build_array())
    ),
    now()
  );

  raise notice 'Created Caspo Demo High School. Org id: %, join code: %, owner: %', v_org_id, v_join_code, v_owner_email;
end $$;
