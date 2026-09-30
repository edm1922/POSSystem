-- ============================================================================
-- BIR Manual Sales Book Entry - RPCs
-- ----------------------------------------------------------------------------
-- Three entry points, all SECURITY DEFINER, all admin-gated where appropriate:
--
--   submit_manual_entry_request  - called by the CASHIER portal. Cashiers have
--       no Supabase Auth session (see src/app/auth/cashier/login/page.tsx), so
--       this cannot be auth-gated. It only ever writes a DRAFT to
--       manual_entry_requests, which counts toward nothing. The real control
--       point is review_manual_entry_request below.
--
--   review_manual_entry_request - called by the ADMIN portal. Gated on
--       auth.uid() being an active admin. This is the trust anchor that the
--       cashier path can never have.
--
--   void_manual_transaction     - called by the ADMIN portal. Same gate.
--
-- Every manual write goes through these functions rather than a direct table
-- insert. Note that transactions/transaction_items still carry
-- `WITH CHECK (true)` insert policies (see fix_stock_deduction.sql:33,38), so
-- the anon key can write rows directly via PostgREST; these paths are strictly
-- narrower than that, not a replacement for it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: is the current caller an active admin?
-- Probes information_schema (not to_regclass, which resolves relations, not
-- columns) so the check degrades gracefully if users.is_active has not been
-- applied yet.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'is_active'
  ) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.users
       WHERE id = v_uid AND role = 'admin' AND is_active = true
    );
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.users WHERE id = v_uid AND role = 'admin'
  );
END;
$$;

COMMENT ON FUNCTION public.is_active_admin() IS
  'True when the current Supabase Auth caller is an active admin in public.users. Always false for cashiers, who have no Auth session.';

-- ----------------------------------------------------------------------------
-- 0. list_manual_entry_requests (CASHIER)
--    Cashiers have no Auth session, so they cannot be given a row-level policy
--    keyed on a real identity. This RPC is the least-bad read path: it scopes
--    results to the cashier id it is given, and it is exposed to anon only
--    because a client-asserted cashier id is forgeable in this architecture.
--    The same caveat applies to the pre-existing direct table writes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_manual_entry_requests(
  p_cashier_id UUID,
  p_status     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cashier_id IS NULL THEN
    RAISE EXCEPTION 'Cashier information is required';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM public.manual_entry_requests r
     WHERE r.source_cashier_id = p_cashier_id
       AND (p_status IS NULL OR r.status = p_status)
  ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.list_manual_entry_requests IS
  'Returns the requesting cashier''s own manual entry drafts, optionally filtered by status.';

-- EXECUTE grants live in add_manual_entry_grants.sql, kept out of this file on
-- purpose: see the header of that file for why.

-- ----------------------------------------------------------------------------
-- 1. submit_manual_entry_request (CASHIER)
--    Writes a draft only. Nothing here affects revenue, stock, or reports.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_manual_entry_request(
  p_cashier_id      UUID,
  p_cashier_username TEXT,
  p_transaction_date DATE,
  p_items            JSONB,
  p_payment_method   TEXT,
  p_sold_by          TEXT    DEFAULT NULL,
  p_manual_ref       TEXT    DEFAULT NULL,
  p_atp_ref          TEXT    DEFAULT NULL,
  p_buyer_tin        TEXT    DEFAULT NULL,
  p_buyer_address    TEXT    DEFAULT NULL,
  p_customer_id      UUID    DEFAULT NULL,
  p_reference_number TEXT    DEFAULT NULL,
  p_term_due_date    DATE    DEFAULT NULL,
  p_amount_received  DECIMAL DEFAULT NULL,
  p_change_amount    DECIMAL DEFAULT NULL,
  p_notes            TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_total    NUMERIC := 0;
  v_item     JSONB;
  v_ref      TEXT;
  v_rec      RECORD;
BEGIN
  -- The cashier id is client-asserted and forgeable in this architecture, so
  -- this function deliberately does NOT trust it for anything privileged. It
  -- is stored for attribution only; all authority is enforced at review time.
  IF p_cashier_id IS NULL THEN
    RAISE EXCEPTION 'Cashier information is required';
  END IF;

  SELECT * INTO v_rec FROM public.cashiers WHERE id = p_cashier_id;
  -- IS NOT TRUE rather than `= false`: cashiers.is_active is nullable
  -- (BOOLEAN DEFAULT TRUE, no NOT NULL), and a NULL would make
  -- `IF NULL THEN` fall through, letting a NULL-flagged cashier submit.
  IF NOT FOUND OR v_rec.is_active IS NOT TRUE OR v_rec.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cashier account is not active';
  END IF;

  IF p_transaction_date IS NULL OR p_transaction_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Receipt date cannot be in the future';
  END IF;

  IF p_transaction_date < (CURRENT_DATE - INTERVAL '5 years') THEN
    RAISE EXCEPTION 'Receipt date is more than 5 years old. Check the date, or record this in the prior period manually.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  IF p_payment_method IS NULL OR btrim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'A payment method is required';
  END IF;

  v_ref := NULLIF(btrim(COALESCE(p_manual_ref, '')), '');

  -- Reject a serial already consumed by an approved entry.
  IF v_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transactions
     WHERE source = 'manual' AND manual_ref = v_ref
  ) THEN
    RAISE EXCEPTION 'BIR serial % has already been entered', v_ref;
  END IF;

  -- Reject a serial another pending request already claims.
  IF v_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.manual_entry_requests
     WHERE status = 'pending' AND manual_ref = v_ref
  ) THEN
    RAISE EXCEPTION 'BIR serial % is already awaiting approval', v_ref;
  END IF;

  -- Recompute the total server-side. The client's number is never trusted.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'quantity')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'Every line item needs a quantity greater than zero';
    END IF;
    IF COALESCE((v_item->>'price')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION 'Line item prices cannot be negative';
    END IF;
    v_total := v_total
      + COALESCE((v_item->>'quantity')::NUMERIC, 0)
      * COALESCE((v_item->>'price')::NUMERIC, 0);
  END LOOP;

  v_total := round(v_total, 2);

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total amount must be greater than zero';
  END IF;

  INSERT INTO public.manual_entry_requests (
    source_cashier_id, source_cashier_name, transaction_date, sold_by,
    manual_ref, atp_ref, buyer_tin, buyer_address, customer_id,
    payment_method, reference_number, term_due_date,
    amount_received, change_amount, notes, items, computed_total
  ) VALUES (
    p_cashier_id, p_cashier_username, p_transaction_date,
    NULLIF(btrim(COALESCE(p_sold_by, '')), ''),
    v_ref,
    NULLIF(btrim(COALESCE(p_atp_ref, '')), ''),
    NULLIF(btrim(COALESCE(p_buyer_tin, '')), ''),
    NULLIF(btrim(COALESCE(p_buyer_address, '')), ''),
    p_customer_id,
    p_payment_method,
    NULLIF(btrim(COALESCE(p_reference_number, '')), ''),
    p_term_due_date,
    p_amount_received,
    p_change_amount,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_items,
    v_total
  )
  RETURNING id INTO v_id;

  INSERT INTO public.activity_logs (user_id, actor_cashier_id, actor_role, action, description, metadata)
  VALUES (
    NULL, p_cashier_id, 'cashier', 'manual_entry_submitted',
    format('Submitted manual BIR entry %s (%s) for %s', COALESCE(v_ref, 'no serial'), v_id, COALESCE(p_cashier_username, 'unknown')),
    jsonb_build_object('request_id', v_id, 'total', v_total, 'cashier_id', p_cashier_id)
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'computed_total', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.submit_manual_entry_request IS
  'Cashier-submits a BIR manual sales book entry as a draft for admin review. Writes nothing to transactions, so it cannot affect revenue, stock, or reports.';

-- ----------------------------------------------------------------------------
-- 2. review_manual_entry_request (ADMIN) - batch capable
--    Takes an array so the admin can clear a stack of receipts in one pass.
--    Per-request failures are captured and reported rather than aborting the
--    whole batch, so one bad serial does not block the other nine.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_manual_entry_request(
  p_request_ids UUID[],
  p_approve     BOOLEAN,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin   UUID := auth.uid();
  r         RECORD;
  v_item    JSONB;
  v_tx_id   UUID;
  v_total   NUMERIC := 0;
  v_result  JSONB;
  v_results JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Admin role required to review manual entries';
  END IF;

  IF p_request_ids IS NULL OR array_length(p_request_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No requests selected';
  END IF;

  IF NOT p_approve AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'A reason is required when rejecting a request';
  END IF;

  FOR r IN
    SELECT * FROM public.manual_entry_requests
     WHERE id = ANY(p_request_ids) AND status = 'pending'
     ORDER BY created_at
  LOOP
    BEGIN
      IF NOT p_approve THEN
        UPDATE public.manual_entry_requests
           SET status      = 'rejected',
               reviewed_at = now(),
               reviewed_by = v_admin,
               review_note = p_note
         WHERE id = r.id;

        v_result := jsonb_build_object(
          'request_id', r.id, 'status', 'rejected', 'message', 'Request rejected'
        );
      ELSE
        -- ---------------- approve ----------------
        IF r.manual_ref IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.transactions
           WHERE source = 'manual' AND manual_ref = r.manual_ref
        ) THEN
          RAISE EXCEPTION 'BIR serial % is already used by an approved entry', r.manual_ref;
        END IF;

        v_total := 0;
        FOR v_item IN SELECT * FROM jsonb_array_elements(r.items)
        LOOP
          v_total := v_total
            + COALESCE((v_item->>'quantity')::NUMERIC, 0)
            * COALESCE((v_item->>'price')::NUMERIC, 0);
        END LOOP;
        v_total := round(v_total, 2);

        IF v_total <= 0 THEN
          RAISE EXCEPTION 'Total amount must be greater than zero';
        END IF;

        INSERT INTO public.transactions (
          source, transaction_date, total_amount, payment_method,
          reference_number, customer_id, status,
          discount_type, discount_value, discount_amount,
          recorded_by_cashier_id, approved_by, sold_by,
          manual_ref, atp_ref, buyer_tin, buyer_address,
          amount_received, change_amount, notes,
          down_payment, term_remaining_balance, term_due_date, term_status
        ) VALUES (
          'manual', r.transaction_date, v_total, r.payment_method,
          r.reference_number, r.customer_id, 'completed',
          NULL, 0, 0,
          r.source_cashier_id, v_admin, r.sold_by,
          r.manual_ref, r.atp_ref, r.buyer_tin, r.buyer_address,
          r.amount_received, r.change_amount, r.notes,
          0,
          CASE WHEN r.payment_method = 'term' THEN v_total ELSE 0 END,
          CASE WHEN r.payment_method = 'term' THEN r.term_due_date ELSE NULL END,
          CASE WHEN r.payment_method = 'term' THEN 'pending' ELSE NULL END
        )
        RETURNING id INTO v_tx_id;

        -- Stock is deducted here by the existing tr_deduct_stock_on_insert
        -- trigger, in the same transaction as the revenue row. Free-text lines
        -- carry a NULL product_id, so the trigger's UPDATE matches zero rows
        -- and they correctly move no inventory.
        FOR v_item IN SELECT * FROM jsonb_array_elements(r.items)
        LOOP
          INSERT INTO public.transaction_items (
            transaction_id, product_id, item_name, quantity, price
          ) VALUES (
            v_tx_id,
            NULLIF(btrim(COALESCE(v_item->>'product_id', '')), '')::UUID,
            COALESCE(NULLIF(btrim(COALESCE(v_item->>'description', '')), ''), 'Item'),
            GREATEST(COALESCE((v_item->>'quantity')::INTEGER, 0), 1),
            COALESCE((v_item->>'price')::NUMERIC, 0)
          );
        END LOOP;

        UPDATE public.manual_entry_requests
           SET status                  = 'approved',
               reviewed_at             = now(),
               reviewed_by             = v_admin,
               review_note             = p_note,
               resulting_transaction_id = v_tx_id
         WHERE id = r.id;

        v_result := jsonb_build_object(
          'request_id', r.id, 'status', 'approved',
          'transaction_id', v_tx_id, 'total', v_total
        );
      END IF;

      v_results := v_results || jsonb_build_array(v_result);

    EXCEPTION WHEN OTHERS THEN
      -- Isolate the failure so the rest of the batch still processes.
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'request_id', r.id, 'status', 'failed', 'message', SQLERRM
        )
      );
    END;
  END LOOP;

  INSERT INTO public.activity_logs (user_id, actor_role, action, description, metadata)
  VALUES (
    v_admin, 'admin',
    CASE WHEN p_approve THEN 'manual_entry_approved' ELSE 'manual_entry_rejected' END,
    format('%s %s manual entr%s',
           CASE WHEN p_approve THEN 'Approved' ELSE 'Rejected' END,
           array_length(p_request_ids, 1),
           CASE WHEN array_length(p_request_ids, 1) = 1 THEN 'y' ELSE 'ies' END),
    jsonb_build_object('request_ids', p_request_ids, 'note', p_note, 'results', v_results)
  );

  RETURN jsonb_build_object('results', v_results);
END;
$$;

COMMENT ON FUNCTION public.review_manual_entry_request IS
  'Admin reviews cashier-submitted manual entries in batch. On approve it creates the transaction and line items, deducting stock via the existing trigger. Drafts never counted toward revenue before this runs.';

-- ----------------------------------------------------------------------------
-- 3. void_manual_transaction (ADMIN)
--    Marks voided. Never deletes: a BIR serial is permanently consumed, and
--    the unique index on transactions.manual_ref must keep holding.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_manual_transaction(
  p_transaction_id UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin UUID := auth.uid();
  v_tx    public.transactions%ROWTYPE;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Admin role required to void a manual entry';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to void a manual entry';
  END IF;

  SELECT * INTO v_tx
    FROM public.transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.source <> 'manual' THEN
    RAISE EXCEPTION 'Only manual entries can be voided here. Use the register void flow instead.';
  END IF;

  IF v_tx.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This entry has already been voided';
  END IF;

  -- Restore stock set-based, one UPDATE per product instead of a per-row loop.
  -- NULL product_id lines are excluded: they never deducted anything, so they
  -- must not restore anything.
  UPDATE public.products p
     SET stock_quantity = p.stock_quantity + agg.qty
    FROM (
      SELECT product_id, SUM(quantity) AS qty
        FROM public.transaction_items
       WHERE transaction_id = p_transaction_id
         AND product_id IS NOT NULL
       GROUP BY product_id
    ) agg
   WHERE p.id = agg.product_id;

  UPDATE public.transactions
     SET voided_at   = now(),
         voided_by   = v_admin,
         void_reason = p_reason
   WHERE id = p_transaction_id;

  INSERT INTO public.activity_logs (user_id, actor_role, action, description, metadata)
  VALUES (
    v_admin, 'admin', 'manual_entry_voided',
    format('Voided manual BIR entry %s (%s)', COALESCE(v_tx.manual_ref, 'no serial'), v_tx.id),
    jsonb_build_object('transaction_id', p_transaction_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'transaction_id', p_transaction_id,
    'manual_ref', v_tx.manual_ref
  );
END;
$$;

COMMENT ON FUNCTION public.void_manual_transaction IS
  'Voids an approved manual entry, restoring stock. Marks the row voided rather than deleting it, so BIR serials stay permanently consumed.';

-- ----------------------------------------------------------------------------
-- Grants
--
-- Cashiers sign in against the custom `cashiers` table and never hold a Supabase
-- Auth session, so their browser only ever carries the `anon` key. The
-- draft-submission path therefore has to be reachable by `anon` or the MANUAL
-- button is dead on arrival. This is not a widening of privilege beyond the
-- existing model (transactions/transaction_items already accept anonymous
-- inserts via `WITH CHECK (true)` policies) and the function is strictly
-- narrower: it only ever writes a DRAFT into manual_entry_requests, and it is
-- SECURITY DEFINER so it does not need any table grants for anon.
--
-- The review and void paths stay admin-only and remain `authenticated` +
-- is_active_admin() gated.
-- ----------------------------------------------------------------------------
-- EXECUTE grants for the four functions above live in
-- add_manual_entry_grants.sql.

-- A rejected request must be correctable in place so its BIR serial stays
-- reserved across the edit. Without this the cashier could only create a new
-- row, which would let two requests compete for the same serial.
CREATE OR REPLACE FUNCTION public.resubmit_manual_entry_request(
  p_request_id          UUID,
  p_transaction_date    DATE,
  p_items               JSONB,
  p_manual_ref          TEXT DEFAULT NULL,
  p_atp_ref             TEXT DEFAULT NULL,
  p_customer_id         UUID DEFAULT NULL,
  p_buyer_tin           TEXT DEFAULT NULL,
  p_buyer_address       TEXT DEFAULT NULL,
  p_sold_by             TEXT DEFAULT NULL,
  p_payment_method      TEXT DEFAULT NULL,
  p_reference_number    TEXT DEFAULT NULL,
  p_term_due_date       DATE DEFAULT NULL,
  p_amount_received     DECIMAL DEFAULT NULL,
  p_change_amount       DECIMAL DEFAULT NULL,
  p_notes               TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_total    NUMERIC := 0;
  v_item     JSONB;
  v_ref      TEXT;
BEGIN
  SELECT * INTO v_existing FROM public.manual_entry_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_existing.status <> 'rejected' THEN
    RAISE EXCEPTION 'Only a rejected entry can be edited. Pending entries are already in the admin queue.';
  END IF;

  IF p_transaction_date IS NULL OR p_transaction_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Receipt date cannot be in the future';
  END IF;

  IF p_transaction_date < (CURRENT_DATE - INTERVAL '5 years') THEN
    RAISE EXCEPTION 'Receipt date is more than 5 years old. Check the date, or record this in the prior period manually.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE(btrim(v_item->>'description'), '') = '' THEN
      RAISE EXCEPTION 'Every line item needs a description';
    END IF;
    IF COALESCE((v_item->>'quantity')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero on every line';
    END IF;
    IF COALESCE((v_item->>'price')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION 'Price cannot be negative on any line';
    END IF;
    v_total := v_total
      + COALESCE((v_item->>'quantity')::NUMERIC, 0) * COALESCE((v_item->>'price')::NUMERIC, 0);
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Total must be greater than zero';
  END IF;

  IF COALESCE(btrim(p_payment_method), '') = '' THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  IF p_payment_method = 'term' AND p_term_due_date IS NULL THEN
    RAISE EXCEPTION 'Term sales need a due date';
  END IF;

  -- Same serial rules as first submission: a serial cannot already be sitting in
  -- `transactions` (which includes voided rows, so a voided serial stays burned).
  IF NULLIF(btrim(p_manual_ref), '') IS NOT NULL THEN
    v_ref := btrim(p_manual_ref);
    IF EXISTS (SELECT 1 FROM public.transactions WHERE manual_ref = v_ref) THEN
      RAISE EXCEPTION 'BIR serial % has already been recorded or voided', v_ref;
    END IF;
    -- ux_mer_pending_manual_ref is UNIQUE across pending rows, so if another
    -- pending request already claims this serial the UPDATE below would abort
    -- with a raw constraint violation. Check first and explain instead. This row
    -- is excluded because it is the one being re-queued.
    IF EXISTS (
      SELECT 1 FROM public.manual_entry_requests
       WHERE status = 'pending' AND manual_ref = v_ref AND id <> p_request_id
    ) THEN
      RAISE EXCEPTION 'BIR serial % is already awaiting approval on another request', v_ref;
    END IF;
  ELSE
    v_ref := NULL;
  END IF;

  UPDATE public.manual_entry_requests
     SET transaction_date = p_transaction_date,
         items            = p_items,
         manual_ref       = v_ref,
         atp_ref          = p_atp_ref,
         customer_id      = p_customer_id,
         buyer_tin        = p_buyer_tin,
         buyer_address    = p_buyer_address,
         sold_by          = p_sold_by,
         payment_method   = p_payment_method,
         reference_number = p_reference_number,
         term_due_date    = p_term_due_date,
         amount_received  = p_amount_received,
         change_amount    = p_change_amount,
         notes            = p_notes,
         computed_total   = v_total,
         status           = 'pending',
         review_note      = NULL,
         reviewed_by      = NULL,
         reviewed_at      = NULL
   WHERE id = p_request_id;

  -- activity_logs has no table_name/record_id columns in this schema, so the
  -- request id travels in metadata instead.
  INSERT INTO public.activity_logs (user_id, actor_cashier_id, actor_role, action, description, metadata)
  VALUES (
    NULL,
    v_existing.source_cashier_id,
    'cashier',
    'manual_entry_resubmitted',
    'Cashier resubmitted BIR manual entry ' || COALESCE(v_ref, '(no serial)'),
    jsonb_build_object('total', v_total, 'request_id', p_request_id)
  );

  RETURN jsonb_build_object('id', p_request_id, 'status', 'pending', 'total', v_total);
END;
$$;

COMMENT ON FUNCTION public.resubmit_manual_entry_request IS
  'Re-queues a rejected manual entry as pending in place, keeping its row and reserved BIR serial.';

-- EXECUTE grant lives in add_manual_entry_grants.sql. It used to be written out
-- here with only 14 argument types instead of this function's 15, which failed
-- with 42883 and rolled back every function in this file.
