-- =============================================================================
-- add_manual_entry_rls.sql
--
-- Admin read policy for the manual-entry approval queue.
--
-- WHY THIS FILE EXISTS
--   `add_manual_entry_schema.sql` creates `manual_entry_requests` with a role
--   grant but no RLS policy. When the table is created through the Supabase
--   dashboard, RLS is enabled by default, and a table with RLS ON and no policy
--   returns an EMPTY SET rather than raising. The approvals page
--   (src/app/admin/approvals/page.tsx) and the navbar badge
--   (src/components/admin/AdminNavbar.tsx) then both show "0 pending" with no
--   error anywhere: the page's red banner stays hidden and the badge swallows
--   its own error to console.error. `CREATE TABLE IF NOT EXISTS` silently skips
--   an existing table, so the schema file cannot correct that state either.
--   This file states the policy explicitly and is safe to re-run.
--
--   Cashier access is unaffected. submit/list/resubmit are SECURITY DEFINER and
--   therefore execute as the function owner, bypassing RLS entirely.
--
-- WHY `is_active_admin()` WORKS INSIDE A POLICY
--   The policy reads `public.users`, which has RLS enabled itself
--   (security_policies.sql). is_active_admin() is SECURITY DEFINER + STABLE, so
--   the lookup runs as the owner and is not filtered by that RLS.
--
-- ORDER
--   Apply AFTER add_manual_entry_functions.sql: the policy depends on
--   public.is_active_admin(). See add_manual_entry_grants.sql for the matching
--   EXECUTE grants.
-- =============================================================================

BEGIN;

-- Report the state being changed, and flag the one failure mode that makes this
-- policy look broken instead of absent.
DO $$
DECLARE
  v_rls      BOOLEAN;
  v_requests BIGINT;
  v_admins   BIGINT;
BEGIN
  SELECT relrowsecurity INTO v_rls
    FROM pg_class
   WHERE relname = 'manual_entry_requests';

  SELECT count(*) INTO v_requests FROM public.manual_entry_requests;
  SELECT count(*) INTO v_admins
    FROM public.users
   WHERE role = 'admin' AND is_active = true;

  RAISE NOTICE 'manual_entry_requests: % row(s), RLS currently %',
    v_requests, CASE WHEN v_rls THEN 'ENABLED' ELSE 'disabled' END;

  IF v_admins = 0 THEN
    RAISE WARNING
      'No active admin row in public.users. This policy grants nothing until one '
      'exists, so the approvals page will keep showing 0 pending. Insert the admin '
      'row, or restore handle_new_user() (it is the only code that creates users '
      'rows), before treating an empty list as a fault in this file.';
  END IF;
END;
$$;

-- RLS filters on top of a role grant; both are required for the admin read.
GRANT ALL ON TABLE manual_entry_requests TO authenticated;

-- Authorise reads in the database rather than relying on the role grant alone.
-- Deliberately tighter than the surrounding tables, whose admin policies are
-- USING (true) (see archive/apply_security_fixes.sql).
ALTER TABLE manual_entry_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all manual entry requests"
  ON public.manual_entry_requests;

-- SELECT only. No INSERT/UPDATE/DELETE policy is created, so RLS denies them:
-- every write still has to go through the SECURITY DEFINER RPCs, which is what
-- keeps approval atomic and the only path into `transactions`.
CREATE POLICY "Admins can view all manual entry requests"
  ON public.manual_entry_requests
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

COMMIT;

-- PostgREST caches the schema; without this the new policy can be ignored.
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verification
--
-- The SQL editor has no JWT, so auth.uid() is NULL and is_active_admin() would
-- return false and the policy would deny -- producing a false negative even
-- though the policy is correct. Supplying request.jwt.claim.sub sets the admin's
-- id so this exercises the real code path an admin's request takes.
--
-- Expect pending_visible_to_admin to equal the pending count. Zero here means the
-- policy is not matching, and the WARNING above explains the most likely reason.
-- =============================================================================
BEGIN;

SELECT set_config(
  'request.jwt.claim.sub',
  coalesce(
    (SELECT id::text
       FROM public.users
      WHERE role = 'admin' AND is_active = true
      ORDER BY created_at
      LIMIT 1),
    ''),
  true
);

SET LOCAL ROLE authenticated;

SELECT count(*) AS pending_visible_to_admin
  FROM public.manual_entry_requests
 WHERE status = 'pending';

ROLLBACK;
