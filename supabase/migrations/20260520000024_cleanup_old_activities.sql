-- Enable pg_cron (no-op if already enabled)
create extension if not exists pg_cron;

-- Weekly job: delete activities (+ cascaded laps and zone splits) older than 2 years
-- Runs every Sunday at 03:00 UTC
select cron.schedule(
  'delete-old-activities',
  '0 3 * * 0',
  $$
    delete from public.activities
    where date < (now() - interval '2 years')::date;
  $$
);
