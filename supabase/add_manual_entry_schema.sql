-- ============================================================================
-- BIR Manual Sales Book Entry - Schema
-- ----------------------------------------------------------------------------
-- Purpose: allow cashiers to key in sales that were already transacted on a
--          BIR-approved manual sales book (never touched the register), which
--          an admin then reviews and approves.
--
-- Design notes:
--   * Drafts live in `manual_entry_requests`, NEVER in `transactions`. The
--     `transactions.status` column already carries a 'pending' value and every
--     report sums `total_amount` unfiltered, so a draft row placed there would
--     silently inflate revenue the moment it was submitted.
--   * `transaction_date` (the BIR receipt date) is the date of record for
--     books/reports. `created_at` only records when the row was keyed in.
--   * `cashier_id` stays NULL on manual rows so they never leak into a
--     cashier's EOD cash reconciliation (which filters on eq('cashier_id',..)).
--     Attribution lives in `recorded_by_cashier_id` instead.
--   * `item_name` snapshots the description so receipts/reports never depend on
--     a products join. This is what makes free-text (product-less) lines work.
--   * Never DELETE. A BIR serial is permanently consumed once used, so the
--     unique index below deliberately does NOT exclude voided rows.
--
-- This file is idempotent: it is hand-applied, there is no migrations/ folder.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Ensure users.is_active exists.
--    archive/apply_transaction_fixes.sql already assumes this column, but
--    schema.sql never declared it. Adding it so role checks can honour it.
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ----------------------------------------------------------------------------
-- 1. transactions - manual entry provenance
-- ----------------------------------------------------------------------------
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_date DATE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recorded_by_cashier_id UUID REFERENCES cashiers(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sold_by TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS manual_ref TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS atp_ref TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS buyer_tin TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS buyer_address TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_received DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS change_amount DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Backfill BEFORE adding constraints. Adding a NOT NULL column with a default
-- would stamp every historical row with today's date instead of its real date.
UPDATE transactions SET source = 'pos' WHERE source IS NULL;
UPDATE transactions
   SET transaction_date = COALESCE(created_at::date, CURRENT_DATE)
 WHERE transaction_date IS NULL;

ALTER TABLE transactions ALTER COLUMN source SET DEFAULT 'pos';
ALTER TABLE transactions ALTER COLUMN source SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN transaction_date SET DEFAULT CURRENT_DATE;
ALTER TABLE transactions ALTER COLUMN transaction_date SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_source_check'
  ) THEN
    ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
  END IF;

  ALTER TABLE transactions
    ADD CONSTRAINT transactions_source_check
    CHECK (source IN ('pos', 'manual'));
END $$;

-- Manual entries legitimately carry 'term' (a BIR manual book records credit
-- sales). The base schema.sql constraint only allows cash|card|mobile, and
-- several partial migrations widen it by different amounts -- the widest being
-- add_term_paid_amount.sql. Widen it here so approval of a manual term sale
-- cannot fail on a database that never had that migration applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_payment_method_check'
  ) THEN
    ALTER TABLE transactions DROP CONSTRAINT transactions_payment_method_check;
  END IF;

  ALTER TABLE transactions
    ADD CONSTRAINT transactions_payment_method_check
    CHECK (payment_method IN (
      'cash', 'card', 'mobile', 'cheque', 'term', 'term_payment'
    ));
END $$;

COMMENT ON COLUMN transactions.source IS
  'pos = rung up on the register. manual = keyed in from a BIR manual sales book and approved by an admin.';
COMMENT ON COLUMN transactions.transaction_date IS
  'Date of record (the BIR receipt date for manual entries). Use this for all books and reports, not created_at.';
COMMENT ON COLUMN transactions.manual_ref IS
  'BIR series + serial from the manual sales book, e.g. 0001-12345. Unique across all manual entries.';
COMMENT ON COLUMN transactions.atp_ref IS
  'BIR Authority to Print number printed on the manual receipt.';
COMMENT ON COLUMN transactions.approved_by IS
  'Admin who reviewed and approved the manual entry.';
COMMENT ON COLUMN transactions.recorded_by_cashier_id IS
  'Cashier who keyed in the manual entry. Separate from cashier_id, which stays NULL so EOD cash reconciliation is unaffected.';
COMMENT ON COLUMN transactions.voided_at IS
  'Set when a manual entry is voided. Rows are never deleted: a BIR serial stays permanently consumed.';
COMMENT ON COLUMN transactions.void_reason IS
  'Mandatory reason for voiding.';

-- ----------------------------------------------------------------------------
-- 2. transaction_items - denormalized description snapshot
-- ----------------------------------------------------------------------------
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS item_name TEXT;

-- Backfill from the linked product, then placeholder any orphans.
UPDATE transaction_items ti
   SET item_name = p.name
  FROM products p
 WHERE p.id = ti.product_id
   AND ti.item_name IS NULL;

UPDATE transaction_items SET item_name = 'Unknown Item' WHERE item_name IS NULL;

ALTER TABLE transaction_items ALTER COLUMN item_name SET NOT NULL;

COMMENT ON COLUMN transaction_items.item_name IS
  'Description snapshot at time of sale. Display source of truth for receipts and reports, so product renames and free-text (NULL product_id) lines both render correctly.';

-- The existing POS insert path writes only (transaction_id, product_id, quantity,
-- price). Once item_name is NOT NULL those inserts start failing, so a trigger
-- fills the snapshot from the product instead of requiring every call site to be
-- updated in lockstep. Manual entries always pass item_name explicitly.
CREATE OR REPLACE FUNCTION public.fn_transaction_items_default_item_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.item_name IS NULL OR btrim(NEW.item_name) = '' THEN
    IF NEW.product_id IS NOT NULL THEN
      SELECT p.name INTO NEW.item_name FROM products p WHERE p.id = NEW.product_id;
    END IF;
    NEW.item_name := COALESCE(NULLIF(btrim(NEW.item_name), ''), 'Unknown Item');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transaction_items_default_item_name ON transaction_items;

CREATE TRIGGER trg_transaction_items_default_item_name
  BEFORE INSERT ON transaction_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_transaction_items_default_item_name();

COMMENT ON FUNCTION public.fn_transaction_items_default_item_name() IS
  'Keeps the legacy POS insert path working after item_name became NOT NULL.';

-- ----------------------------------------------------------------------------
-- 3. manual_entry_requests - the approval queue
--    Drafts never touch `transactions`, so no report needs to learn about a
--    draft state and the Register/Manual/Combined split stays honest.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual_entry_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_cashier_id UUID REFERENCES cashiers(id),
  source_cashier_name TEXT,
  transaction_date DATE NOT NULL,
  sold_by TEXT,
  manual_ref TEXT,
  atp_ref TEXT,
  buyer_tin TEXT,
  buyer_address TEXT,
  customer_id UUID REFERENCES customers(id),
  payment_method TEXT NOT NULL,
  reference_number TEXT,
  term_due_date DATE,
  amount_received DECIMAL(10,2),
  change_amount DECIMAL(10,2),
  notes TEXT,
  -- [{description, product_id (nullable), quantity, price}]
  items JSONB NOT NULL,
  computed_total DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  review_note TEXT,
  resulting_transaction_id UUID REFERENCES transactions(id)
);

COMMENT ON TABLE manual_entry_requests IS
  'Cashier-submitted BIR manual sales book entries awaiting admin review. Drafts only; nothing here counts toward revenue until approved.';
COMMENT ON COLUMN manual_entry_requests.items IS
  'JSONB array of line items: [{description, product_id|null, quantity, price}]. Promoted into transaction_items on approval.';
COMMENT ON COLUMN manual_entry_requests.manual_ref IS
  'BIR series + serial. Checked against both transactions.manual_ref and other pending requests to catch duplicates before they reach the books.';

-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------
-- A duplicate BIR serial is an audit finding, so it is blocked. No
-- `voided_at IS NULL` predicate: voiding must never free a consumed serial.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_manual_ref
  ON transactions (manual_ref)
  WHERE source = 'manual' AND manual_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tx_source_date
  ON transactions (source, transaction_date);

CREATE INDEX IF NOT EXISTS ix_tx_recorded_by_cashier
  ON transactions (recorded_by_cashier_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS ix_mer_status
  ON manual_entry_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_mer_cashier
  ON manual_entry_requests (source_cashier_id, created_at DESC);

-- Partial unique index so two pending requests cannot claim the same serial.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mer_pending_manual_ref
  ON manual_entry_requests (manual_ref)
  WHERE status = 'pending' AND manual_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. activity_logs
--    user_id FKs users(id), but cashiers live in a separate `cashiers` table,
--    so any cashier-scoped log would FK-violate. Make it nullable and add a
--    free-form actor_role. Nothing in the app writes here today, which is why
--    this has stayed latent.
-- ----------------------------------------------------------------------------
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS actor_cashier_id UUID REFERENCES cashiers(id);
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE activity_logs ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN activity_logs.user_id IS
  'Admin who performed the action, when applicable. Nullable: cashiers live in a separate table and cannot be referenced here.';
COMMENT ON COLUMN activity_logs.actor_cashier_id IS
  'Cashier who performed the action, for cashier-scoped events such as manual entry submission.';
COMMENT ON COLUMN activity_logs.actor_role IS
  'Role of the actor: admin | cashier | system.';

-- ----------------------------------------------------------------------------
-- 6. Grants. RLS insert policies on transactions/transaction_items are
--    currently WITH CHECK (true) (see fix_stock_deduction.sql), so the anon key
--    can already write rows directly via PostgREST. All manual-entry writes go
--    through SECURITY DEFINER RPCs, which is strictly narrower.
--
--    `manual_entry_requests` is deliberately NOT granted to `anon`: cashiers
--    reach their own drafts through the SECURITY DEFINER RPCs in
--    add_manual_entry_functions.sql, which is narrower than a table-wide grant.
-- ----------------------------------------------------------------------------
-- Function EXECUTE grants live in add_manual_entry_grants.sql, which is applied
-- after add_manual_entry_functions.sql.
GRANT ALL ON TABLE manual_entry_requests TO authenticated;

-- The row-level policy that authorises the admin read lives in
-- add_manual_entry_rls.sql, not here: it depends on public.is_active_admin(),
-- which add_manual_entry_functions.sql defines, and this file is applied first.
-- That is the same ordering constraint as the grants file above. Keep this file
-- RLS-agnostic so it can create the table on a fresh project.
