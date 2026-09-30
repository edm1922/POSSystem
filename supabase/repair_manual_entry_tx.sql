-- =============================================================================
-- repair_manual_entry_tx.sql
--
-- Rebuilds a `transactions` row that was deleted RAW from the Supabase
-- dashboard after a manual entry had already been approved. It restores what
-- review_manual_entry_request created, re-registers the BIR serial in
-- ux_tx_manual_ref, re-seats the approval's resulting_transaction_id, and
-- re-enables the admin void flow.
--
-- It deliberately does NOT restore stock. After this script the entry is live
-- again, and stock should be returned by voiding through the admin portal
-- (void_manual_transaction), which is the exact path the feature was designed
-- around: restore once, mark voided, keep the serial consumed.
--
-- USAGE
--   1. Set v_request_id below to the approved request's id, or leave the
--      placeholder as-is to target the most recently reviewed approved request.
--   2. Run the whole file in the Supabase SQL editor. Everything is one
--      transaction: if anything raises, the trigger-disable rolls back too, so
--      stock cannot be double-deducted.
--   3. In the browser: Admin -> Approvals -> Approved tab -> void the entry.
--
-- SAFETY
--   * Refuses to run when the transactions row already exists (already repaired)
--     or when the request is not 'approved'.
--   * Disables tr_deduct_stock_on_insert only around the re-insert, then
--     re-enables it. The AFTER-INSERT stock trigger is what would otherwise
--     deduct the quantities a second time.
-- =============================================================================

DO $$
DECLARE
  -- Set to the specific request id, or keep the placeholder for "most recent".
  v_request_id      UUID := '00000000-0000-0000-0000-000000000000';

  v_req             public.manual_entry_requests%ROWTYPE;
  v_total           NUMERIC := 0;
  v_item            JSONB;
  v_new_tx_id       UUID;
  v_orphans         BIGINT := 0;
  v_term_refs       BIGINT := 0;
BEGIN
  -- ---- 1. Locate the request -----------------------------------------------
  SELECT * INTO v_req FROM public.manual_entry_requests WHERE id = v_request_id;

  IF NOT FOUND THEN
    IF v_request_id = '00000000-0000-0000-0000-000000000000' THEN
      SELECT * INTO v_req FROM public.manual_entry_requests
       WHERE status = 'approved'
       ORDER BY reviewed_at DESC NULLS LAST
       LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No approved manual entry request exists to repair';
      END IF;
      v_request_id := v_req.id;
    ELSE
      RAISE EXCEPTION 'Request % not found', v_request_id;
    END IF;
  END IF;

  -- ---- 2. Guards ------------------------------------------------------------
  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Request % is %; only an approved request can be repaired', v_req.id, v_req.status;
  END IF;

  IF v_req.resulting_transaction_id IS NULL THEN
    RAISE EXCEPTION 'Request % has no resulting_transaction_id to repair', v_req.id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.transactions WHERE id = v_req.resulting_transaction_id) THEN
    RAISE EXCEPTION
      'Transaction % still exists. Nothing to repair and re-inserting would duplicate it.',
      v_req.resulting_transaction_id;
  END IF;

  IF v_req.items IS NULL THEN
    RAISE EXCEPTION 'Request % has no items payload; cannot rebuild line items', v_req.id;
  END IF;

  SELECT count(*) INTO v_orphans
    FROM public.transaction_items
   WHERE transaction_id = v_req.resulting_transaction_id;

  IF to_regclass('public.term_payments') IS NOT NULL THEN
    SELECT count(*) INTO v_term_refs
      FROM public.term_payments
     WHERE transaction_id = v_req.resulting_transaction_id;
  END IF;

  RAISE NOTICE
    'Repairing request % (manual_ref %), old tx %, orphan item rows %, term payment refs %',
    v_req.id, v_req.manual_ref, v_req.resulting_transaction_id, v_orphans, v_term_refs;

  -- ---- 3. Server-side total, matching review_manual_entry_request ----------
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_req.items)
  LOOP
    v_total := v_total
      + COALESCE((v_item->>'quantity')::NUMERIC, 0)
      * COALESCE((v_item->>'price')::NUMERIC, 0);
  END LOOP;
  v_total := round(v_total, 2);

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Computed total for request % is %; refusing to rebuild', v_req.id, v_total;
  END IF;

  -- ---- 4. Remove orphaned children of the deleted transaction ---------------
  DELETE FROM public.transaction_items
   WHERE transaction_id = v_req.resulting_transaction_id;

  -- ---- 5. Rebuild transaction + items WITHOUT re-deducting stock ------------
  ALTER TABLE public.transaction_items DISABLE TRIGGER tr_deduct_stock_on_insert;

  INSERT INTO public.transactions (
    source, transaction_date, total_amount, payment_method,
    reference_number, customer_id, status,
    discount_type, discount_value, discount_amount,
    recorded_by_cashier_id, approved_by, sold_by,
    manual_ref, atp_ref, buyer_tin, buyer_address,
    amount_received, change_amount, notes,
    down_payment, term_remaining_balance, term_due_date, term_status
  ) VALUES (
    'manual', v_req.transaction_date, v_total, v_req.payment_method,
    v_req.reference_number, v_req.customer_id, 'completed',
    NULL, 0, 0,
    v_req.source_cashier_id, v_req.reviewed_by, v_req.sold_by,
    v_req.manual_ref, v_req.atp_ref, v_req.buyer_tin, v_req.buyer_address,
    v_req.amount_received, v_req.change_amount, v_req.notes,
    0,
    CASE WHEN v_req.payment_method = 'term' THEN v_total ELSE 0 END,
    CASE WHEN v_req.payment_method = 'term' THEN v_req.term_due_date ELSE NULL END,
    CASE WHEN v_req.payment_method = 'term' THEN 'pending' ELSE NULL END
  )
  RETURNING id INTO v_new_tx_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_req.items)
  LOOP
    INSERT INTO public.transaction_items (
      transaction_id, product_id, item_name, quantity, price
    ) VALUES (
      v_new_tx_id,
      NULLIF(btrim(COALESCE(v_item->>'product_id', '')), '')::UUID,
      COALESCE(NULLIF(btrim(COALESCE(v_item->>'description', '')), ''), 'Item'),
      GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 0), 1),
      COALESCE((v_item->>'price')::NUMERIC, 0)
    );
  END LOOP;

  ALTER TABLE public.transaction_items ENABLE TRIGGER tr_deduct_stock_on_insert;

  -- ---- 6. Re-seat references -------------------------------------------------
  UPDATE public.manual_entry_requests
     SET resulting_transaction_id = v_new_tx_id
   WHERE id = v_request_id;

  IF to_regclass('public.term_payments') IS NOT NULL AND v_term_refs > 0 THEN
    UPDATE public.term_payments
       SET transaction_id = v_new_tx_id
     WHERE transaction_id = v_req.resulting_transaction_id;
  END IF;

  RAISE NOTICE 'Rebuilt tx % for request % (manual_ref %)', v_new_tx_id, v_request_id, v_req.manual_ref;
  RAISE NOTICE
    'Next: void this entry from the Admin portal (Approvals -> Approved) so stock is restored and the serial stays consumed.';
END;
$$;

-- Post-run confirmation: recent approved requests with their live transaction state.
SELECT r.id AS request_id, r.manual_ref, r.resulting_transaction_id,
       t.status, t.voided_at, t.total_amount
  FROM public.manual_entry_requests r
  LEFT JOIN public.transactions t ON t.id = r.resulting_transaction_id
 WHERE r.status = 'approved'
 ORDER BY r.reviewed_at DESC NULLS LAST
 LIMIT 5;