alter table users
  add column if not exists on_period boolean not null default false,
  add column if not exists period_severity text check (period_severity in ('minor', 'medium', 'severe')) default null;
