create table if not exists ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  function_name text not null,
  created_at timestamptz not null default now()
);

create index ai_usage_log_user_created on ai_usage_log(user_id, created_at);

alter table ai_usage_log enable row level security;

-- Users can only see their own log entries (read-only; inserts go via service role)
create policy "own rows only" on ai_usage_log
  for select using (auth.uid() = user_id);
