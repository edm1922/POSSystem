-- Explicit grants so the admin portal (authenticated role) can record and undo
-- term payments from the Down Payments section of the Reports page.
-- These RPCs are SECURITY DEFINER (bypass RLS); granting EXECUTE to
-- authenticated is safe, matching the pattern in add_manual_entry_grants.sql.
-- Without these, execution relies on Postgres' default PUBLIC EXECUTE grant.

GRANT EXECUTE ON FUNCTION public.update_transaction_term_paid_amount(UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_term_payment(UUID) TO authenticated;