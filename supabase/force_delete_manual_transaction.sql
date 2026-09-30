-- =============================================================================
-- force_delete_manual_transaction.sql
--
-- Hard-removes a manual-entry transaction and its dependent rows from the
-- database, bypassing the void flow entirely. Use ONLY when you want the entry
-- purged with no audit trail of a void.
--
-- WHAT IT DELETES  (transactional, atomic)
--   * the exact `transactions` row (source = 'manual')
--   * its `transaction_items` rows
--   * the `manual_entry_requests` approval row(s) linked via
--     resulting_transaction_id (this FK is what would otherwise block the
--     delete)
--   * any `term_payment_allocations` rows referencing the transaction. The
--     parent `term_payments` rows are customer-money records and are left
--     untouched.
--
-- WHAT IT ALSO DOES
--   * Restores product stock for the item quantities, because approval
--     deducted it and a raw delete would otherwise leave inventory
--     permanently short.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH
--   * `activity_logs` entries describing the approval/void remain for history
--     (they only embed the id in JSON metadata; no FK).
--   * The BIR serial is NOT tracked anywhere after this: 001565 becomes
--     reusable, which is an audit concern. Void keeps serial consumption;
--     this delete does not.
--
-- SAFETY
--   * Refuses to run if the transaction id does not exist or is not a manual
--     entry (register sales use the register void flow, not this).
-- =============================================================================

DO $$
DECLARE
  v_tx_id     UUID := '5bc2ce3f-fac9-4203-b46b-5f412e8502b0';
  v_tx        public.transactions%ROWTYPE;
  v_requests  BIGINT := 0;
  v_items     BIGINT := 0;
  v_term_alloc BIGINT := 0;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = v_tx_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction % not found. Nothing to delete.', v_tx_id;
  END IF;

  IF v_tx.source <> 'manual' THEN
    RAISE EXCEPTION
      'Refusing: transaction % is a register sale (source = %), not a manual entry.',
      v_tx_id, v_tx.source;
  END IF;

  SELECT count(*) INTO v_requests
    FROM public.manual_entry_requests
   WHERE resulting_transaction_id = v_tx_id;

  SELECT count(*) INTO v_items
    FROM public.transaction_items
   WHERE transaction_id = v_tx_id;

  IF to_regclass('public.term_payment_allocations') IS NOT NULL THEN
    SELECT count(*) INTO v_term_alloc
      FROM public.term_payment_allocations
     WHERE transaction_id = v_tx_id;
  END IF;

  RAISE NOTICE 'Force-deleting tx % (status = %, manual_ref = %, total = %)',
    v_tx_id, v_tx.status, v_tx.manual_ref, v_tx.total_amount;
  RAISE NOTICE 'Dependent rows: % approval request(s), % line item(s), % term allocation(s)',
    v_requests, v_items, v_term_alloc;

  -- 1. Restore stock deducted at approval (set-based, same shape the void uses).
  UPDATE public.products p
     SET stock_quantity = p.stock_quantity + agg.qty
    FROM (
      SELECT product_id, SUM(quantity) AS qty
        FROM public.transaction_items
       WHERE transaction_id = v_tx_id
         AND product_id IS NOT NULL
       GROUP BY product_id
    ) agg
   WHERE p.id = agg.product_id;

  -- 2. Remove dependents first so the FK chain does not block the main delete.
  DELETE FROM public.manual_entry_requests
   WHERE resulting_transaction_id = v_tx_id;

  IF to_regclass('public.term_payment_allocations') IS NOT NULL THEN
    DELETE FROM public.term_payment_allocations
     WHERE transaction_id = v_tx_id;
  END IF;

  DELETE FROM public.transaction_items
   WHERE transaction_id = v_tx_id;

  -- 3. The transaction itself.
  DELETE FROM public.transactions
   WHERE id = v_tx_id;

  RAISE NOTICE 'Deleted tx % and % dependent row(s). Manual Book Sales card will read 0 after refresh.',
    v_tx_id, v_requests + v_items + v_term_alloc;
END;
$$;

-- Post-run confirmation: every reference to the transaction is gone.
SELECT
  (SELECT count(*) FROM public.transactions          WHERE id = '5bc2ce3f-fac9-4203-b46b-5f412e8502b0') AS tx_rows,
  (SELECT count(*) FROM public.transaction_items     WHERE transaction_id = '5bc2ce3f-fac9-4203-b46b-5f412e8502b0') AS item_rows,
  (SELECT count(*) FROM public.manual_entry_requests WHERE resulting_transaction_id = '5bc2ce3f-fac9-4203-b46b-5f412e8502b0') AS request_rows;