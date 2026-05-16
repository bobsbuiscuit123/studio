-- Paste this into Supabase Dashboard > SQL Editor > New query.
-- This seeds only the HopeLink demo organization.
-- Join code: HPLINK

do $$
declare
  v_owner_email text := 'pratheek.mukkavilli@gmail.com';
  v_owner_id uuid;
  v_owner_name text;
  v_org_id uuid;
  v_group_id uuid;
  v_join_code text := 'HPLINK';
  v_member_pool jsonb;
  v_group record;
  v_group_members jsonb;
  v_group_emails jsonb;
  v_point_entries jsonb;
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
    'HopeLink',
    v_join_code,
    'Nonprofit',
    'HopeLink is a nonprofit volunteer organization focused on adding as many people as possible to the stem cell and bone marrow donor registries through DKMS and NMDP drives, training, partnerships, and follow-up outreach.',
    'Weekly planning huddles plus monthly donor registry drives',
    'https://placehold.co/512x512/0f766e/ffffff?text=HopeLink',
    v_owner_id,
    v_owner_id,
    'free',
    0,
    0,
    now(),
    now() + interval '30 days',
    0,
    false,
    300,
    4,
    24000,
    now()
  )
  on conflict (join_code) do update
    set name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        meeting_time = excluded.meeting_time,
        logo_url = excluded.logo_url,
        created_by = excluded.created_by,
        owner_id = excluded.owner_id,
        usage_estimate_members = excluded.usage_estimate_members,
        usage_estimate_requests_per_member = excluded.usage_estimate_requests_per_member,
        usage_estimate_monthly_tokens = excluded.usage_estimate_monthly_tokens,
        updated_at = now()
  returning id into v_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (v_owner_id, v_org_id, 'owner')
  on conflict (user_id, org_id) do update set role = 'owner';

  select jsonb_agg(
    jsonb_build_object(
      'id', format('hopelink-volunteer-%s', lpad(i::text, 3, '0')),
      'name', format('%s %s', first_names[((i - 1) % array_length(first_names, 1)) + 1], last_names[((i - 1) % array_length(last_names, 1)) + 1]),
      'email', format(
        '%s.%s.%s@volunteer.hopelink.demo',
        lower(first_names[((i - 1) % array_length(first_names, 1)) + 1]),
        lower(last_names[((i - 1) % array_length(last_names, 1)) + 1]),
        lpad(i::text, 3, '0')
      ),
      'role', case when i <= 18 then 'Officer' else 'Member' end,
      'avatar', format(
        'https://placehold.co/96x96/0f766e/ffffff?text=%s%s',
        left(first_names[((i - 1) % array_length(first_names, 1)) + 1], 1),
        left(last_names[((i - 1) % array_length(last_names, 1)) + 1], 1)
      ),
      'chapter', case
        when i <= 72 then 'Drive Operations'
        when i <= 166 then 'Campus Outreach'
        when i <= 222 then 'Community Partnerships'
        when i <= 264 then 'Training and Compliance'
        else 'Fundraising and Grants'
      end,
      'joinedAt', (now() - ((i % 210) + 10) * interval '1 day')::text,
      'dataAiHint', 'hope volunteer portrait'
    )
    order by i
  )
  into v_member_pool
  from generate_series(1, 300) as s(i)
  cross join (
    select
      array[
        'Aaliyah','Aaron','Aisha','Alex','Amara','Andre','Anika','Arjun','Avery','Ben',
        'Bianca','Caleb','Camila','Carlos','Chloe','Daniel','Deja','Diego','Elena','Eli',
        'Emily','Fatima','Gabriel','Grace','Hana','Isaac','Jada','Jalen','Jasmine','Kai',
        'Kavya','Layla','Leo','Lina','Luis','Maya','Mia','Miles','Nadia','Nina',
        'Noah','Omar','Priya','Rafael','Sam','Sara','Sofia','Talia','Theo','Zara'
      ] as first_names,
      array[
        'Adams','Ahmed','Bennett','Brooks','Carter','Chen','Cooper','Diaz','Edwards','Flores',
        'Garcia','Ghosh','Green','Hall','Hernandez','Hughes','Iyer','Johnson','Khan','Kim',
        'Lee','Lopez','Martinez','Mehta','Miller','Nguyen','Ortiz','Patel','Price','Rahman',
        'Reed','Rivera','Robinson','Rodriguez','Roy','Sanchez','Shah','Singh','Smith','Thomas',
        'Torres','Tran','Walker','Williams','Wilson','Wong','Wu','Young','Zhang','Zimmerman'
      ] as last_names
  ) as name_bank;

  for v_group in
    select *
    from (
      values
        (1, 'HopeLink Volunteer Network', 'nonprofit', 'The full HopeLink volunteer roster for registry drive coordination, all-hands updates, and organization-wide announcements.', 'HL00', 1, 300, 18, 'Maya Shah', 'maya.shah@hopelink.demo', '0f766e', 'volunteer-network', '300 active volunteers and 1,200 registry additions this quarter', 'HopeLink HQ'),
        (2, 'Donor Drive Captains', 'operations', 'Captains who run check-in tables, explain DKMS/NMDP consent, pack swab kits, and report drive totals.', 'HL01', 1, 72, 8, 'Andre Hill', 'andre.hill@hopelink.demo', '0369a1', 'drive-captains', '45 drives and 720 completed swabs', 'Community Health Center'),
        (3, 'Campus Ambassador Team', 'outreach', 'Student and young alumni ambassadors who recruit donors through campus tabling, residence hall visits, and student organization partnerships.', 'HL02', 73, 94, 8, 'Priya Raman', 'priya.raman@hopelink.demo', '7c3aed', 'campus-ambassadors', '35 campus partners and 500 registry signups', 'University Quad'),
        (4, 'Community Partnerships', 'partnerships', 'Volunteers who build relationships with faith groups, cultural associations, small businesses, and clinic partners for donor drives.', 'HL03', 167, 56, 6, 'Elena Torres', 'elena.torres@hopelink.demo', 'b45309', 'community-partnerships', '25 community hosts and 400 new registry additions', 'Partner Sites'),
        (5, 'Training and Compliance', 'training', 'Trainers who prepare volunteers to explain donor eligibility, privacy expectations, swab-kit handling, and respectful recruitment.', 'HL04', 223, 42, 5, 'Dr. Hana Kim', 'hana.kim@hopelink.demo', 'be123c', 'training-compliance', '100% trained captains before every public drive', 'Virtual Training Room'),
        (6, 'Fundraising and Grants', 'fundraising', 'Grant writers, donor relations volunteers, and sponsors who fund swab kits, outreach materials, and patient-family support events.', 'HL05', 265, 36, 5, 'Rafael Ortiz', 'rafael.ortiz@hopelink.demo', '15803d', 'fundraising-grants', '$18,000 in drive sponsorships and patient support funds', 'HopeLink Office')
    ) as g(sort_order, name, type, description, join_code, member_start, member_count, officer_count, admin_name, admin_email, accent, slug, target, primary_location)
  loop
    insert into public.groups (org_id, name, type, description, join_code, created_by)
    values (
      v_org_id,
      v_group.name,
      v_group.type,
      v_group.description,
      v_group.join_code,
      v_owner_id
    )
    on conflict (org_id, join_code) do update
      set name = excluded.name,
          type = excluded.type,
          description = excluded.description,
          created_by = excluded.created_by
    returning id into v_group_id;

    insert into public.group_memberships (org_id, group_id, user_id, role)
    values (v_org_id, v_group_id, v_owner_id, 'admin')
    on conflict (user_id, group_id) do update set role = 'admin';

    select jsonb_build_array(
      jsonb_build_object(
        'id', v_owner_id::text,
        'name', coalesce(v_owner_name, 'HopeLink Admin'),
        'email', v_owner_email,
        'role', 'Admin',
        'avatar', 'https://placehold.co/96x96/0f766e/ffffff?text=HA',
        'chapter', 'Leadership'
      ),
      jsonb_build_object(
        'id', format('%s-program-lead', v_group.slug),
        'name', v_group.admin_name,
        'email', v_group.admin_email,
        'role', 'Admin',
        'avatar', format('https://placehold.co/96x96/%s/ffffff?text=%s', v_group.accent, left(v_group.admin_name, 1)),
        'chapter', 'Program Staff'
      )
    ) || coalesce(jsonb_agg(
      member.value || jsonb_build_object(
        'role', case when member.group_position <= v_group.officer_count then 'Officer' else 'Member' end
      )
      order by member.idx
    ), '[]'::jsonb)
    into v_group_members
    from (
      select
        pool_member.value,
        pool_member.ordinality as idx,
        row_number() over (order by pool_member.ordinality) as group_position
      from jsonb_array_elements(v_member_pool) with ordinality as pool_member(value, ordinality)
      where pool_member.ordinality between v_group.member_start and v_group.member_start + v_group.member_count - 1
    ) as member;

    select jsonb_agg(member.value->>'email' order by member.ordinality)
    into v_group_emails
    from jsonb_array_elements(v_group_members) with ordinality as member(value, ordinality);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', format('%s-points-%s', v_group.slug, member.idx),
        'memberEmail', member.value->>'email',
        'points', ((member.idx % 5) + 2)::int,
        'reason', case
          when member.idx % 4 = 0 then 'Drive check-in table'
          when member.idx % 4 = 1 then 'Registry education conversation'
          when member.idx % 4 = 2 then 'Swab kit packing and verification'
          else 'Partner outreach follow-up'
        end,
        'date', (now() - (((member.idx % 18) + 1) * interval '1 day'))::text,
        'awardedBy', v_group.admin_email
      )
      order by member.idx
    ), '[]'::jsonb)
    into v_point_entries
    from (
      select value, ordinality as idx
      from jsonb_array_elements(v_group_members) with ordinality as member(value, ordinality)
      where value->>'email' <> v_owner_email
      order by ordinality
      limit 28
    ) as member;

    insert into public.group_state (org_id, group_id, data, updated_at)
    values (
      v_org_id,
      v_group_id,
      jsonb_build_object(
        'members', v_group_members,
        'events', jsonb_build_array(
          jsonb_build_object(
            'id', format('%s-weekly-sync', v_group.slug),
            'title', format('%s weekly huddle', v_group.name),
            'description', format('Review upcoming DKMS/NMDP registry drives, volunteer assignments, donor education talking points, and this group''s target: %s.', v_group.target),
            'date', (now() - interval '10 days')::text,
            'location', v_group.primary_location,
            'hasTime', true,
            'points', 2,
            'checkInCode', upper(substr(v_group.join_code || 'S1', 1, 6)),
            'attendees', jsonb_build_array(v_group_emails->>0, v_group_emails->>1, v_group_emails->>2, v_group_emails->>3, v_group_emails->>4, v_group_emails->>5),
            'attendanceRecords', jsonb_build_array(
              jsonb_build_object('email', v_group_emails->>1, 'checkedInAt', (now() - interval '10 days' + interval '4 minutes')::text),
              jsonb_build_object('email', v_group_emails->>2, 'checkedInAt', (now() - interval '10 days' + interval '6 minutes')::text),
              jsonb_build_object('email', v_group_emails->>3, 'checkedInAt', (now() - interval '10 days' + interval '8 minutes')::text)
            ),
            'rsvps', jsonb_build_object(
              'yes', jsonb_build_array(v_group_emails->>0, v_group_emails->>1, v_group_emails->>2, v_group_emails->>3, v_group_emails->>4, v_group_emails->>5),
              'no', jsonb_build_array(),
              'maybe', jsonb_build_array(v_group_emails->>6, v_group_emails->>7)
            ),
            'viewedBy', jsonb_build_array(v_owner_email, v_group_emails->>1, v_group_emails->>2),
            'tags', jsonb_build_array('registry', 'planning', 'DKMS', 'NMDP'),
            'aiTagged', true
          ),
          jsonb_build_object(
            'id', format('%s-saturday-drive', v_group.slug),
            'title', format('%s registry drive', v_group.name),
            'description', 'Public donor registry drive with eligibility screening, consent review, cheek swab collection, kit labeling, and end-of-shift reconciliation.',
            'date', (now() + (v_group.sort_order + 4) * interval '1 day')::text,
            'location', v_group.primary_location,
            'hasTime', true,
            'points', 5,
            'checkInCode', upper(substr(v_group.join_code || 'D2', 1, 6)),
            'attendees', jsonb_build_array(v_group_emails->>1, v_group_emails->>2, v_group_emails->>3, v_group_emails->>4),
            'attendanceRecords', jsonb_build_array(),
            'rsvps', jsonb_build_object(
              'yes', jsonb_build_array(v_group_emails->>1, v_group_emails->>2, v_group_emails->>3, v_group_emails->>4, v_group_emails->>5, v_group_emails->>6),
              'no', jsonb_build_array(v_group_emails->>9),
              'maybe', jsonb_build_array(v_group_emails->>7, v_group_emails->>8)
            ),
            'rsvpRequired', true,
            'recipients', v_group_emails,
            'tags', jsonb_build_array('drive', 'swab kits', 'volunteers')
          ),
          jsonb_build_object(
            'id', format('%s-kit-night', v_group.slug),
            'title', 'Swab kit packing night',
            'description', 'Prepare consent cards, barcode labels, extra pens, table signs, eligibility handouts, and return envelopes for the next HopeLink drive.',
            'date', (now() - interval '4 days')::text,
            'location', 'HopeLink Supply Room',
            'hasTime', true,
            'points', 3,
            'attendees', jsonb_build_array(v_group_emails->>1, v_group_emails->>4, v_group_emails->>6, v_group_emails->>8),
            'attendanceRecords', jsonb_build_array(
              jsonb_build_object('email', v_group_emails->>4, 'checkedInAt', (now() - interval '4 days' + interval '5 minutes')::text),
              jsonb_build_object('email', v_group_emails->>6, 'checkedInAt', (now() - interval '4 days' + interval '7 minutes')::text)
            ),
            'tags', jsonb_build_array('operations', 'materials')
          ),
          jsonb_build_object(
            'id', format('%s-training-refresh', v_group.slug),
            'title', 'Registry education refresher',
            'description', 'Practice how to explain stem cell donation, donor commitment, age guidelines, privacy expectations, and the difference between joining the registry and donating.',
            'date', (now() + (v_group.sort_order + 12) * interval '1 day')::text,
            'location', 'Zoom',
            'hasTime', true,
            'points', 2,
            'attendees', jsonb_build_array(),
            'attendanceRecords', jsonb_build_array(),
            'rsvpRequired', true,
            'tags', jsonb_build_array('training', 'education', 'compliance')
          )
        ),
        'announcements', jsonb_build_array(
          jsonb_build_object('id', 7000 + v_group.sort_order * 10 + 1, 'title', format('%s goal for this month', v_group.name), 'content', format('HopeLink goal: %s. Please keep conversations clear, respectful, and focused on helping people understand the DKMS/NMDP registry commitment.', v_group.target), 'author', v_group.admin_email, 'date', (now() - interval '9 days')::text, 'read', false, 'viewedBy', jsonb_build_array(v_owner_email, v_group_emails->>1, v_group_emails->>2, v_group_emails->>3), 'tags', jsonb_build_array('goals', 'registry'), 'aiTagged', true),
          jsonb_build_object('id', 7000 + v_group.sort_order * 10 + 2, 'title', 'Volunteer script update', 'content', 'Use the updated opening line: we help people join the stem cell donor registry so patients searching through DKMS and NMDP have more possible matches.', 'author', v_group.admin_email, 'date', (now() - interval '6 days')::text, 'read', false, 'viewedBy', jsonb_build_array(v_group_emails->>1, v_group_emails->>4), 'tags', jsonb_build_array('training', 'script')),
          jsonb_build_object('id', 7000 + v_group.sort_order * 10 + 3, 'title', 'Drive captain checklist', 'content', 'Before every drive: confirm table placement, volunteer arrival windows, consent-card count, swab-kit count, QR code signage, and secure storage for completed kits.', 'author', v_group.admin_email, 'date', (now() - interval '3 days')::text, 'read', false, 'viewedBy', jsonb_build_array(v_owner_email, v_group_emails->>2), 'linkedFormId', format('%s-drive-report', v_group.slug), 'tags', jsonb_build_array('operations', 'forms'))
        ),
        'pointEntries', v_point_entries,
        'transactions', jsonb_build_array(
          jsonb_build_object('id', format('%s-txn-1', v_group.slug), 'description', 'Local sponsor donation for swab-kit supplies', 'amount', 1250 + v_group.sort_order * 75, 'date', (now() - interval '18 days')::text, 'status', 'Deposit'),
          jsonb_build_object('id', format('%s-txn-2', v_group.slug), 'description', 'Drive signage, clipboards, and table materials', 'amount', -186 - v_group.sort_order * 9, 'date', (now() - interval '14 days')::text, 'status', 'Withdrawal'),
          jsonb_build_object('id', format('%s-txn-3', v_group.slug), 'description', 'Community awareness night donations', 'amount', 640 + v_group.sort_order * 40, 'date', (now() - interval '8 days')::text, 'status', 'Deposit')
        ),
        'galleryImages', jsonb_build_array(
          jsonb_build_object('id', 8000 + v_group.sort_order * 10 + 1, 'src', format('https://placehold.co/900x620/%s/ffffff?text=%s+Drive', v_group.accent, replace(v_group.slug, '-', '+')), 'alt', format('%s donor registry table', v_group.name), 'author', v_group_emails->>2, 'date', (now() - interval '7 days')::text, 'likes', 34 + v_group.sort_order, 'likedBy', jsonb_build_array(v_owner_email, v_group_emails->>1), 'status', 'approved', 'read', false),
          jsonb_build_object('id', 8000 + v_group.sort_order * 10 + 2, 'src', format('https://placehold.co/900x620/%s/ffffff?text=Swab+Kits', v_group.accent), 'alt', 'Prepared swab kits and consent cards', 'author', v_group_emails->>4, 'date', (now() - interval '4 days')::text, 'likes', 21 + v_group.sort_order, 'likedBy', jsonb_build_array(v_group_emails->>3), 'status', 'approved', 'read', false)
        ),
        'forms', jsonb_build_array(
          jsonb_build_object(
            'id', format('%s-drive-report', v_group.slug),
            'title', 'Registry drive report',
            'description', 'Capture drive totals, kit counts, supply gaps, and follow-up notes after each HopeLink donor registry drive.',
            'questions', jsonb_build_array(
              jsonb_build_object('id', 'q1', 'prompt', 'Drive location', 'required', true, 'kind', 'shortText'),
              jsonb_build_object('id', 'q2', 'prompt', 'How many people joined the registry?', 'required', true, 'kind', 'shortText'),
              jsonb_build_object('id', 'q3', 'prompt', 'Which registry partner materials were used?', 'required', true, 'kind', 'multi', 'options', jsonb_build_array('DKMS handouts', 'NMDP QR code', 'Eligibility one-pager', 'Patient story cards')),
              jsonb_build_object('id', 'q4', 'prompt', 'Any supply or consent issues?', 'required', false, 'kind', 'shortText')
            ),
            'createdBy', v_group.admin_email,
            'createdAt', (now() - interval '12 days')::text,
            'viewedBy', jsonb_build_array(v_owner_email, v_group_emails->>1, v_group_emails->>2),
            'responses', jsonb_build_array(
              jsonb_build_object('id', format('%s-drive-report-response-1', v_group.slug), 'respondentEmail', v_group_emails->>1, 'submittedAt', (now() - interval '8 days')::text, 'answers', jsonb_build_object('q1', v_group.primary_location, 'q2', (42 + v_group.sort_order * 7)::text, 'q3', 'DKMS handouts, NMDP QR code, Patient story cards', 'q4', 'Need more pens and extra barcode labels'))
            ),
            'linkedAnnouncementId', 7000 + v_group.sort_order * 10 + 3
          ),
          jsonb_build_object(
            'id', format('%s-training-attestation', v_group.slug),
            'title', 'Volunteer training attestation',
            'description', 'Confirm that volunteers understand donor eligibility basics, consent language, privacy expectations, and handoff steps.',
            'questions', jsonb_build_array(
              jsonb_build_object('id', 'q1', 'prompt', 'I can explain that joining the registry is not the same as donating today.', 'required', true, 'kind', 'single', 'options', jsonb_build_array('Yes', 'Need more practice')),
              jsonb_build_object('id', 'q2', 'prompt', 'I know when to refer medical eligibility questions to official DKMS/NMDP materials.', 'required', true, 'kind', 'single', 'options', jsonb_build_array('Yes', 'Need more practice')),
              jsonb_build_object('id', 'q3', 'prompt', 'What part of the script feels hardest?', 'required', false, 'kind', 'shortText')
            ),
            'createdBy', v_group.admin_email,
            'createdAt', (now() - interval '7 days')::text,
            'viewedBy', jsonb_build_array(v_group_emails->>3, v_group_emails->>4),
            'responses', jsonb_build_array()
          )
        ),
        'messages', jsonb_build_object(),
        'groupChats', jsonb_build_array(
          jsonb_build_object(
            'id', format('%s-lead-chat', v_group.slug),
            'name', format('%s Leads', v_group.name),
            'members', jsonb_build_array(v_owner_email, v_group.admin_email, v_group_emails->>1, v_group_emails->>2, v_group_emails->>3, v_group_emails->>4),
            'messages', jsonb_build_array(
              jsonb_build_object('id', format('%s-chat-1', v_group.slug), 'sender', v_group.admin_email, 'text', 'Reminder: every completed kit needs the consent card checked before it goes into the return envelope.', 'timestamp', (now() - interval '1 day')::text, 'readBy', jsonb_build_array(v_group.admin_email, v_owner_email)),
              jsonb_build_object('id', format('%s-chat-2', v_group.slug), 'sender', v_group_emails->>1, 'text', 'I can bring extra table signs and the Spanish-language handouts.', 'timestamp', (now() - interval '20 hours')::text, 'readBy', jsonb_build_array(v_group.admin_email, v_group_emails->>1))
            )
          )
        ),
        'socialPosts', jsonb_build_array(
          jsonb_build_object('id', 8500 + v_group.sort_order * 10 + 1, 'title', 'Why registry drives matter', 'content', 'Every new person who joins the registry gives patients searching through DKMS and NMDP another possible path to a lifesaving match.', 'images', jsonb_build_array(format('https://placehold.co/900x620/%s/ffffff?text=Why+It+Matters', v_group.accent)), 'dataAiHint', 'hope donor registry', 'author', v_group.admin_email, 'date', (now() - interval '5 days')::text, 'likes', 88 + v_group.sort_order * 3, 'comments', jsonb_build_array(jsonb_build_object('author', v_group_emails->>2, 'text', 'This is the clearest explanation for first-time volunteers.')), 'read', false),
          jsonb_build_object('id', 8500 + v_group.sort_order * 10 + 2, 'title', 'Drive recap', 'content', format('%s logged a strong week of outreach. Keep the follow-up warm, accurate, and patient-centered.', v_group.name), 'images', jsonb_build_array(format('https://placehold.co/900x620/%s/ffffff?text=Drive+Recap', v_group.accent)), 'dataAiHint', 'volunteer drive recap', 'author', v_group_emails->>1, 'date', (now() - interval '2 days')::text, 'likes', 57 + v_group.sort_order * 4, 'comments', jsonb_build_array(jsonb_build_object('author', v_owner_email, 'text', 'Great work keeping the process organized and welcoming.')), 'read', false)
        ),
        'presentations', jsonb_build_array(
          jsonb_build_object(
            'id', 9000 + v_group.sort_order,
            'prompt', format('Create a short HopeLink training deck for %s volunteers.', v_group.name),
            'createdAt', (now() - interval '11 days')::text,
            'slides', jsonb_build_array(
              jsonb_build_object('id', format('%s-slide-1', v_group.slug), 'title', 'HopeLink mission', 'content', 'Grow the stem cell donor registry by helping more eligible people understand and complete the DKMS/NMDP signup process.'),
              jsonb_build_object('id', format('%s-slide-2', v_group.slug), 'title', 'Volunteer promise', 'content', 'Be accurate, respectful, privacy-minded, and clear that joining the registry is a real future commitment.'),
              jsonb_build_object('id', format('%s-slide-3', v_group.slug), 'title', 'Drive workflow', 'content', 'Welcome, explain, screen basic eligibility, confirm consent, supervise swab, verify labels, thank the registrant, and log totals.')
            )
          )
        ),
        'logo', 'https://placehold.co/512x512/0f766e/ffffff?text=HopeLink',
        'mindmap', jsonb_build_object(
          'nodes', jsonb_build_array(
            jsonb_build_object('id', format('%s-root', v_group.slug), 'type', 'input', 'data', jsonb_build_object('label', format('%s plan', v_group.name)), 'position', jsonb_build_object('x', 260, 'y', 10)),
            jsonb_build_object('id', format('%s-recruit', v_group.slug), 'data', jsonb_build_object('label', 'Recruit eligible donors'), 'position', jsonb_build_object('x', 60, 'y', 140)),
            jsonb_build_object('id', format('%s-educate', v_group.slug), 'data', jsonb_build_object('label', 'Explain DKMS/NMDP registry'), 'position', jsonb_build_object('x', 260, 'y', 140)),
            jsonb_build_object('id', format('%s-swab', v_group.slug), 'data', jsonb_build_object('label', 'Complete consent and swab'), 'position', jsonb_build_object('x', 470, 'y', 140))
          ),
          'edges', jsonb_build_array(
            jsonb_build_object('id', format('%s-edge-1', v_group.slug), 'source', format('%s-root', v_group.slug), 'target', format('%s-recruit', v_group.slug)),
            jsonb_build_object('id', format('%s-edge-2', v_group.slug), 'source', format('%s-root', v_group.slug), 'target', format('%s-educate', v_group.slug)),
            jsonb_build_object('id', format('%s-edge-3', v_group.slug), 'source', format('%s-root', v_group.slug), 'target', format('%s-swab', v_group.slug))
          )
        )
      ),
      now()
    )
    on conflict (group_id) do update
      set org_id = excluded.org_id,
          data = excluded.data,
          updated_at = excluded.updated_at;
  end loop;

  raise notice 'Seeded HopeLink. Org id: %, org join code: %, group join codes: HL00-HL05, owner: %', v_org_id, v_join_code, v_owner_email;
end $$;
