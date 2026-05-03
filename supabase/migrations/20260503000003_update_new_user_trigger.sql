-- Updated trigger: saves profile fields from user_metadata set during signUp
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, name, username, date_of_birth, terms_accepted_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'username',
    (new.raw_user_meta_data->>'date_of_birth')::date,
    case
      when new.raw_user_meta_data->>'terms_accepted_at' is not null
      then (new.raw_user_meta_data->>'terms_accepted_at')::timestamptz
      else null
    end
  )
  on conflict (id) do update set
    name              = coalesce(excluded.name, public.users.name),
    username          = coalesce(excluded.username, public.users.username),
    date_of_birth     = coalesce(excluded.date_of_birth, public.users.date_of_birth),
    terms_accepted_at = coalesce(excluded.terms_accepted_at, public.users.terms_accepted_at);
  return new;
end;
$$;
