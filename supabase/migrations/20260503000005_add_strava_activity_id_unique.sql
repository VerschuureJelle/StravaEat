do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_strava_activity_id_key'
      and conrelid = 'activities'::regclass
  ) then
    alter table activities add constraint activities_strava_activity_id_key unique (strava_activity_id);
  end if;
end $$;
