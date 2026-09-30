'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrency } from '@/context/CurrencyContext';
import {
  UserCircle,
  ShoppingCart,
  Calendar,
  Download,
  CreditCard,
  DollarSign,
  Smartphone,
  CalendarDays,
  AlertCircle,
  HandCoins
} from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  created_at: string;
}

interface CustomerTransaction {
  id: string;
  total_amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  term_remaining_balance?: number;
  term_paid_amount?: number;
  term_due_date?: string;
  term_status?: string;
}

interface TermPaymentRecord {
  id: string;
  amount: number;
  payment_method: string;
  notes?: string;
  created_at: string;
}

interface CustomerDetailModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
}

export function CustomerDetailModal({ customer, isOpen, onClose }: CustomerDetailModalProps) {
  const { formatPrice } = useCurrency();
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [termPayments, setTermPayments] = useState<TermPaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && customer) {
      fetchTransactions();
    }
  }, [isOpen, customer]);

  const fetchTransactions = async () => {
    if (!customer) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, total_amount, payment_method, status, created_at, transaction_date, source, manual_ref')
        .eq('customer_id', customer.id)
        .is('voided_at', null)
        .order('transaction_date', { ascending: true });

      if (error) throw error;
      setTransactions(data || []);

      const { data: payments, error: paymentsError } = await supabase
        .from('term_payments')
        .select('id, amount, payment_method, notes, created_at')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: true });
      if (paymentsError) throw paymentsError;
      setTermPayments(payments || []);
    } catch (error) {
      console.error('Error fetching customer transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalSpent = transactions.reduce((sum, t) => sum + Number(t.total_amount || 0), 0);
  const visitCount = transactions.length;
  const firstTransaction = transactions.length > 0 ? transactions[0] : null;
  const latestTransaction = transactions.length > 0 ? transactions[transactions.length - 1] : null;

  const outstandingTerm = transactions
    .filter(t => t.payment_method === 'term')
    .reduce((sum, t) => {
      const owed = (t.term_remaining_balance || t.total_amount) - (t.term_paid_amount || 0);
      return sum + Math.max(0, owed);
    }, 0);

  const paymentIcon = (method: string) => {
    switch (method) {
      case 'cash': return <DollarSign className="h-3.5 w-3.5" />;
      case 'card': return <CreditCard className="h-3.5 w-3.5" />;
      case 'mobile': return <Smartphone className="h-3.5 w-3.5" />;
      case 'term': return <CalendarDays className="h-3.5 w-3.5" />;
      case 'term_payment': return <HandCoins className="h-3.5 w-3.5" />;
      default: return <DollarSign className="h-3.5 w-3.5" />;
    }
  };

  const downloadTransactions = () => {
    if (transactions.length === 0) return;

    const headers = ['Date', 'Amount', 'Payment Method', 'Status'];
    const rows = transactions.map(t => [
      new Date(t.created_at).toLocaleDateString(),
      formatPrice(Number(t.total_amount)),
      t.payment_method,
      t.status
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${customer?.name || 'customer'}-transactions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadTermPayments = () => {
    if (termPayments.length === 0) return;

    const headers = ['Date', 'Amount Paid', 'Method', 'Notes'];
    const rows = termPayments.map(p => [
      new Date(p.created_at).toLocaleDateString(),
      formatPrice(Number(p.amount)),
      p.payment_method,
      p.notes || ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${customer?.name || 'customer'}-term-payments.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!customer) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Customer Details" size="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 pb-4 border-b border-gray-100 dark:border-gray-700">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <UserCircle className="h-10 w-10" />
          </div>
          <div>
            <h3 className="text-xl font-black text-gray-900 dark:text-white">{customer.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />
              Customer since {new Date(customer.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-6 w-28" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30">
              <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400">Total Spent</p>
              <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{formatPrice(totalSpent)}</p>
            </div>
            <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Visit Count</p>
              <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{visitCount}</p>
            </div>
            <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30">
              <p className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">First Transaction</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                {firstTransaction ? new Date(firstTransaction.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-orange-50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30">
              <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">Latest Transaction</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">
                {latestTransaction ? new Date(latestTransaction.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
              </p>
            </div>
            {outstandingTerm > 0 && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Outstanding Term</p>
                <p className="text-xl font-black text-red-600 dark:text-red-400 mt-1">{formatPrice(outstandingTerm)}</p>
              </div>
            )}
          </div>
        )}

        {/* Transactions Table */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              Transaction History
            </h4>
            {transactions.length > 0 && (
              <Button
                onClick={downloadTransactions}
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV
              </Button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : transactions.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Payment</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium text-gray-900 dark:text-white">
                        {new Date(t.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-xs font-black text-gray-900 dark:text-white">
                        {formatPrice(Number(t.total_amount))}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs capitalize text-muted-foreground">
                          {paymentIcon(t.payment_method)}
                          {t.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          t.status === 'completed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : t.status === 'cancelled'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-20 text-muted-foreground" />
              <p className="text-sm font-medium text-muted-foreground">No transaction history</p>
              <p className="text-xs text-muted-foreground mt-0.5">This customer has not made any purchases yet.</p>
            </div>
          )}
        </div>

        {termPayments.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-orange-500" />
                Term Payment History
              </h4>
              <Button
                onClick={downloadTermPayments}
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Download CSV
              </Button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount Paid</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Method</th>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {termPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium text-gray-900 dark:text-white">
                        {new Date(p.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-3 text-xs font-black text-green-600">
                        {formatPrice(Number(p.amount))}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs capitalize text-muted-foreground">
                          {paymentIcon('term_payment')}
                          {p.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{p.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
