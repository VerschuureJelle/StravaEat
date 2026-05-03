alter table public.users
  add column if not exists username       text unique,
  add column if not exists date_of_birth  date,
  add column if not exists terms_accepted_at timestamptz;
