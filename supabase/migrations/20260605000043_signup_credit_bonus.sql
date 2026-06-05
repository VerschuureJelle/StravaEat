-- Grant signup bonus credits via the user-creation trigger so ALL new users
-- receive credits regardless of signup method (email, Strava OAuth, etc.).
-- Amount is hardcoded here; adjust via a new migration if the bonus changes.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, name, username, date_of_birth, terms_accepted_at)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'username',
    (new.raw_user_meta_data->>'date_of_birth')::date,
    CASE
      WHEN new.raw_user_meta_data->>'terms_accepted_at' IS NOT NULL
      THEN (new.raw_user_meta_data->>'terms_accepted_at')::timestamptz
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO UPDATE SET
    name              = COALESCE(EXCLUDED.name,              public.users.name),
    username          = COALESCE(EXCLUDED.username,          public.users.username),
    date_of_birth     = COALESCE(EXCLUDED.date_of_birth,     public.users.date_of_birth),
    terms_accepted_at = COALESCE(EXCLUDED.terms_accepted_at, public.users.terms_accepted_at);

  -- Signup bonus: 10 credits for every new account, idempotent
  INSERT INTO public.credit_transactions (user_id, amount, reason)
  SELECT new.id, 10, 'signup_bonus'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE user_id = new.id AND reason = 'signup_bonus'
  );

  RETURN new;
END;
$$;
