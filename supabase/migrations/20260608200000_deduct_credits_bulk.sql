-- Bulk credit deduction: deducts p_amount credits atomically.
-- Returns FALSE when balance is insufficient.
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE balance INT;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO balance
  FROM credit_transactions WHERE user_id = p_user_id;

  IF balance < p_amount THEN RETURN FALSE; END IF;

  INSERT INTO credit_transactions (user_id, amount, reason)
  VALUES (p_user_id, -p_amount, 'ai_use');
  RETURN TRUE;
END; $$;
