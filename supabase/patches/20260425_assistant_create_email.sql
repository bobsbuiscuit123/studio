alter table public.assistant_pending_actions
  drop constraint if exists assistant_pending_actions_action_type_check;

alter table public.assistant_pending_actions
  add constraint assistant_pending_actions_action_type_check check (
    action_type in (
      'create_announcement',
      'update_announcement',
      'create_event',
      'update_event',
      'create_message',
      'create_email'
    )
  );

alter table public.assistant_action_logs
  drop constraint if exists assistant_action_logs_action_type_check;

alter table public.assistant_action_logs
  add constraint assistant_action_logs_action_type_check check (
    action_type in (
      'create_announcement',
      'update_announcement',
      'create_event',
      'update_event',
      'create_message',
      'create_email'
    )
  );
