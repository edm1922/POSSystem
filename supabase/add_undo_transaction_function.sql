-- Reverses a completed register sale: restores stock and marks transaction as cancelled.
-- Runs with SECURITY DEFINER to bypass RLS (cashiers aren't authenticated via Supabase Auth).
CREATE OR REPLACE FUNCTION public.undo_transaction(p_transaction_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item RECORD;
  v_status TEXT;
  v_source TEXT;
BEGIN
  SELECT status, source INTO v_status, v_source
    FROM public.transactions
    WHERE id = p_transaction_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Manual BIR entries are admin-only. The register void path is reachable by
  -- any cashier from the receipt modal (src/app/cashier/pos/page.tsx), so
  -- without this guard a cashier could void a BIR record. They must go
  -- through void_manual_transaction(), which is auth-gated and requires a
  -- reason and preserves the serial as consumed.
  IF v_source = 'manual' THEN
    RAISE EXCEPTION 'Manual entries cannot be voided from the register. Ask an admin to void it.';
  END IF;

  -- Idempotency guard: without this, calling twice restores stock twice.
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'This transaction has already been cancelled';
  END IF;

  -- Restore stock for each product in the transaction
  FOR item IN
    SELECT product_id, quantity
    FROM transaction_items
    WHERE transaction_id = p_transaction_id
  LOOP
    UPDATE public.products
    SET stock_quantity = stock_quantity + item.quantity
    WHERE id = item.product_id;
  END LOOP;

  -- Mark the transaction as cancelled
  UPDATE public.transactions
  SET status = 'cancelled'
  WHERE id = p_transaction_id;
END;
$$;

COMMENT ON FUNCTION public.undo_transaction IS
  'Reverses a completed register sale: restores product stock and sets status to cancelled. Refuses manual BIR entries (admin-only via void_manual_transaction) and is idempotent.';
