-- ============================================================================
-- BIR Manual Sales Book Entry - EXECUTE grants
-- ----------------------------------------------------------------------------
-- Deliberately a SEPARATE file from add_manual_entry_functions.sql.
--
-- These statements name every function's full argument-type list by hand, and
-- a wrong list is fatal: `GRANT EXECUTE ON FUNCTION f(a, b)` does not warn that
-- f(a, b, c) exists, it just reports
--
--     42883: function public.f(a, b) does not exist
--
-- and because the Supabase SQL editor runs a pasted script as one transaction,
-- that single bad GRANT used to roll back every function definition in the
-- file along with it. A malformed GRANT took down submit, list, review, void
-- and resubmit at once, and the only symptom in the app was a 404 on the RPC.
--
-- With the grants isolated here, a typo costs you privileges on one function
-- and leaves the bodies intact.
--
-- Apply order:
--   1. add_manual_entry_schema.sql
--   2. add_manual_entry_functions.sql
--   3. this file
--   4. NOTIFY pgrst, 'reload schema';
--
-- Re-running this file is safe; GRANT is idempotent.
-- ============================================================================

-- Read + submit + resubmit are exposed to anon on purpose. Cashiers hold the
-- anon key and have no Supabase Auth session (see src/app/auth/cashier/login),
-- so they cannot be gated on auth.uid(). These functions are deliberately
-- narrow -- they read or write only the caller's own drafts. The real control
-- point is review_manual_entry_request, which requires an active admin.
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_manual_entry_requests(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_manual_entry_request(UUID, TEXT, DATE, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DECIMAL, DECIMAL, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_manual_entry_request(UUID, DATE, JSONB, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DECIMAL, DECIMAL, TEXT) TO anon, authenticated;

-- Review and void move money and stock, so these are admin-session only and
-- additionally re-check is_active_admin() inside the function body.
GRANT EXECUTE ON FUNCTION public.review_manual_entry_request(UUID[], BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_manual_transaction(UUID, TEXT) TO authenticated;
