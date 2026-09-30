export interface User {
  id: string;
  email: string;
  role: 'admin' | 'cashier';
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  stock_quantity: number;
  barcode?: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  cashier_id: string | null;
  total_amount: number;
  payment_method: string;
  discount_type?: string | null;
  discount_value?: number;
  discount_amount?: number;
  down_payment?: number;
  term_remaining_balance?: number;
  term_due_date?: string;
  term_status?: string;
  term_paid_amount?: number;
  status: 'completed' | 'cancelled' | 'pending';

  /** 'pos' = rung up on the register. 'manual' = keyed in from a BIR manual sales book. */
  source?: TransactionSource;
  /** Date of record (the BIR receipt date for manual entries). Filter books and reports on this, not created_at. */
  transaction_date?: string;
  approved_by?: string | null;
  recorded_by_cashier_id?: string | null;
  sold_by?: string | null;
  manual_ref?: string | null;
  atp_ref?: string | null;
  buyer_tin?: string | null;
  buyer_address?: string | null;
  amount_received?: number | null;
  change_amount?: number | null;
  notes?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;

  created_at: string;
}

export type TransactionSource = 'pos' | 'manual';

export interface TransactionItem {
  id: string;
  transaction_id: string;
  /** NULL for free-text lines (delivery fee, labor, custom work). */
  product_id: string | null;
  /** Description snapshot at time of sale; the display source of truth. */
  item_name: string;
  quantity: number;
  price: number;
  created_at: string;
}

/** A line item inside a draft manual entry, before it becomes a transaction. */
export interface ManualEntryItem {
  /** null for a free-text line that is not tied to a catalogue product */
  product_id: string | null;
  description: string;
  quantity: number;
  price: number;
}

export interface ManualEntryRequest {
  id: string;
  source_cashier_id: string | null;
  source_cashier_name: string | null;
  transaction_date: string;
  sold_by: string | null;
  manual_ref: string | null;
  atp_ref: string | null;
  buyer_tin: string | null;
  buyer_address: string | null;
  customer_id: string | null;
  payment_method: string;
  reference_number: string | null;
  term_due_date: string | null;
  amount_received: number | null;
  change_amount: number | null;
  notes: string | null;
  items: ManualEntryItem[];
  computed_total: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  resulting_transaction_id: string | null;
}

export interface Customer {
  id: string;
  name: string;
  address?: string | null;
  tin_number?: string | null;
  balance_override?: number;
  created_at: string;
  updated_at: string;
}

export interface TermPayment {
  id: string;
  customer_id: string;
  cashier_id: string;
  amount: number;
  payment_method: string;
  notes?: string;
  created_at: string;
}

export interface TermPaymentAllocation {
  id: string;
  term_payment_id: string;
  transaction_id: string;
  amount: number;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  /** Admin who performed the action. Null for cashier actions - cashiers live in a separate table. */
  user_id?: string | null;
  actor_role?: string | null;
  action: string;
  description?: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}