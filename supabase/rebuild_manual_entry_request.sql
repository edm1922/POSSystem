-- =============================================================================
-- rebuild_manual_entry_request.sql
--
-- Restores the approval-request row for a manual entry whose
-- `manual_entry_requests` row was deleted from the dashboard, while the
-- `transactions` row and its `transaction_items` still exist.
--
-- If transactions were deleted instead, use repair_manual_entry_tx.sql and do
-- NOT run this file (the guard below refuses it anyway).
--
-- WHILE THE TRANSACTION ALREADY EXISTS
--   * Stock was deducted once at approval and was never restored. This script
--     does not touch stock: the entry is re-linked, then voiding through the
--     admin portal calls void_manual_transaction, which restores the quantities
--     exactly once and marks the row voided. Net result = original stock.
--   * The BIR serial stays in ux_tx_manual_ref; the request is status
--     'approved', so it does not collide with the partial unique index that
--     guards *pending* requests.
--
-- RESULT
--   Admin -> Approvals -> Approved tab shows the entry with a working Void
--   button, because the button reads this request's resulting_transaction_id.
-- =============================================================================

DO $$
DECLARE
  v_tx_id      UUID := '5bc2ce3f-fac9-4203-b46b-5f412e8502b0';
  v_request_id UUID;
  v_items      JSONB;
  v_tx         public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = v_tx_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found. If you deleted the transaction also, use repair_manual_entry_tx.sql instead.', v_tx_id;
  END IF;

  IF v_tx.source <> 'manual' THEN
    RAISE EXCEPTION 'Transaction % is not a manual entry (source = %).', v_tx_id, v_tx.source;
  END IF;

  IF v_tx.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaction % is already voided; there is nothing left to test.', v_tx_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.manual_entry_requests WHERE resulting_transaction_id = v_tx_id) THEN
    RAISE EXCEPTION 'A request already points at transaction %. Nothing to rebuild.', v_tx_id;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'product_id', ti.product_id::text,
      'description', ti.item_name,
      'quantity',   ti.quantity,
      'price',      ti.price::numeric
    ))
    INTO v_items
    FROM public.transaction_items ti
   WHERE ti.transaction_id = v_tx_id;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'No transaction_items exist for transaction %.', v_tx_id;
  END IF;

  INSERT INTO public.manual_entry_requests (
    source_cashier_id, source_cashier_name, transaction_date, sold_by,
    manual_ref, atp_ref, buyer_tin, buyer_address, customer_id,
    payment_method, reference_number, term_due_date,
    amount_received, change_amount, notes,
    items, computed_total, status,
    reviewed_at, reviewed_by, resulting_transaction_id
  ) VALUES (
    v_tx.recorded_by_cashier_id, NULL, v_tx.transaction_date, v_tx.sold_by,
    v_tx.manual_ref, v_tx.atp_ref, v_tx.buyer_tin, v_tx.buyer_address, v_tx.customer_id,
    COALESCE(NULLIF(btrim(COALESCE(v_tx.payment_method, '')), ''), 'cash'),
    v_tx.reference_number, v_tx.term_due_date,
    v_tx.amount_received, v_tx.change_amount, v_tx.notes,
    v_items, v_tx.total_amount, 'approved',
    now(), v_tx.approved_by, v_tx_id
  )
  RETURNING id INTO v_request_id;

  RAISE NOTICE 'Recreated approved request % for tx % (manual_ref %)',
    v_request_id, v_tx_id, COALESCE(v_tx.manual_ref, 'no serial');
  RAISE NOTICE
    'Next: Admin portal -> Approvals -> Approved tab. Void this entry (reason required). '
    'Stock is restored once and the row is marked voided; the serial stays consumed.';
END;
$$;

-- Confirmation: the new request and its live transaction.
SELECT r.id AS request_id, r.status, r.manual_ref,
       r.resulting_transaction_id, r.computed_total,
       t.status AS tx_status, t.voided_at
  FROM public.manual_entry_requests r
  LEFT JOIN public.transactions t ON t.id = r.resulting_transaction_id
 WHERE r.resulting_transaction_id = '5bc2ce3f-fac9-4203-b46b-5f412e8502b0';