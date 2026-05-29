-- AI credit ledger
CREATE TABLE credit_transactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount     INT NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN (
               'signup_bonus', 'subscription_monthly',
               'ai_use', 'manual_grant', 'refund'
             )),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON credit_transactions(user_id);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_credits" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Atomic deduct: returns FALSE when balance is 0
CREATE OR REPLACE FUNCTION deduct_credit(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE balance INT;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO balance
  FROM credit_transactions WHERE user_id = p_user_id;

  IF balance <= 0 THEN RETURN FALSE; END IF;

  INSERT INTO credit_transactions (user_id, amount, reason)
  VALUES (p_user_id, -1, 'ai_use');
  RETURN TRUE;
END; $$;

-- Read-only balance helper for the mobile client
CREATE OR REPLACE FUNCTION get_credit_balance(p_user_id UUID)
RETURNS INT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(amount), 0)::INT
  FROM credit_transactions WHERE user_id = p_user_id;
$$;
