alter table users
  add column if not exists onboarding_data     jsonb,
  add column if not exists onboarding_complete boolean default false;
