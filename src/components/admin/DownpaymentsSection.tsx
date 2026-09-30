'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useCurrency } from '@/context/CurrencyContext';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal } from '@/components/ui/Modal';
import {
  HandCoins,
  Wallet,
  CalendarDays,
  Search,
  RotateCcw,
  AlertTriangle,
  Banknote,
  CreditCard,
  Smartphone,
  ScrollText,
  FileText,
  Calendar,
  UserRound,
  ReceiptText,
} from 'lucide-react';

interface ReportPeriod {
  startIso: string;
  endIso: string | null;
}

interface AccountRow {
  id: string;
  customer_id?: string | null;
  customer_name: string;
  source: 'register' | 'manual';
  manual_ref?: string | null;
  total_amount: number;
  down_payment: number;
  term_paid_amount: number;
  term_remaining_balance: number;
  outstanding: number;
  term_due_date?: string | null;
  transaction_date?: string | null;
}

interface CollectionRow {
  id: string;
  customer_name: string;
  collector: string;
  amount: number;
  payment_method: string;
  reference_number?: string | null;
  created_at: string;
  allocations: Array<{ transaction_id: string; amount: number }>;
  target_labels: string[];
}

interface OutstandingBucket {
  id: string;
  label: string;
  owed: number;
  total_amount: number;
  term_remaining_balance: number;
  term_paid_amount: number;
}

type AccountFilter = 'open' | 'overdue' | 'paid' | 'all';

const METHODS_REQUIRING_REFERENCE = ['card', 'mobile', 'cheque'];

export default function DownpaymentsSection({
  period,
  onRecorded,
}: {
  period: ReportPeriod;
  onRecorded?: () => void;
}) {
  const { formatPrice } = useCurrency();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccountFilter>('open');

  const [isRecordOpen, setIsRecordOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<Array<{ id: string; name: string }>>([]);
  const [recCustomer, setRecCustomer] = useState<{ id: string; name: string } | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingBucket[]>([]);
  const [recAmount, setRecAmount] = useState('');
  const [recMethod, setRecMethod] = useState('cash');
  const [recReference, setRecReference] = useState('');
  const [recNotes, setRecNotes] = useState('');

  const [pendingUndo, setPendingUndo] = useState<CollectionRow | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      let collQuery = supabase
        .from('term_payments')
        .select('*, term_payment_allocations(transaction_id, amount)')
        .gte('created_at', period.startIso);
      if (period.endIso) collQuery = collQuery.lte('created_at', period.endIso);

      const [
        { data: custData },
        { data: acctData, error: acctError },
        { data: collData },
        { data: usersData },
        { data: cashiersData },
      ] = await Promise.all([
        supabase.from('customers').select('id, name'),
        supabase
          .from('transactions')
          .select(
            'id, customer_id, total_amount, down_payment, term_paid_amount, term_remaining_balance, term_due_date, transaction_date, created_at, source, manual_ref'
          )
          .eq('payment_method', 'term')
          .eq('status', 'completed')
          .is('voided_at', null),
        collQuery.order('created_at', { ascending: false }),
        supabase.from('users').select('id, email'),
        supabase.from('cashiers').select('id, username, email'),
      ]);
      if (acctError) throw acctError;

      const customerMap = new Map<string, string>();
      (custData || []).forEach((c: any) => customerMap.set(c.id, c.name));

      const collectorMap = new Map<string, string>();
      (cashiersData || []).forEach((c: any) => collectorMap.set(c.id, c.username || c.email));
      (usersData || []).forEach((u: any) => collectorMap.set(u.id, u.email));

      const rows: AccountRow[] = (acctData || []).map((t: any) => ({
        id: t.id,
        customer_id: t.customer_id,
        customer_name: customerMap.get(t.customer_id) || 'Unknown',
        source: t.source === 'manual' ? 'manual' : 'register',
        manual_ref: t.manual_ref || null,
        total_amount: Number(t.total_amount || 0),
        down_payment: Number(t.down_payment || 0),
        term_paid_amount: Number(t.term_paid_amount || 0),
        term_remaining_balance: Number(t.term_remaining_balance || t.total_amount || 0),
        outstanding: Math.max(
          0,
          (Number(t.term_remaining_balance) || Number(t.total_amount) || 0) - (Number(t.term_paid_amount) || 0)
        ),
        term_due_date: t.term_due_date || null,
        transaction_date: t.transaction_date || t.created_at,
      }));
      setAccounts(rows);

      const txTargetIds = Array.from(
        new Set(
          (collData || []).flatMap((p: any) =>
            (p.term_payment_allocations || []).map((a: any) => a.transaction_id)
          )
        )
      );
      const txLabelMap: Record<string, string> = {};
      if (txTargetIds.length > 0) {
        const { data: txData } = await supabase
          .from('transactions')
          .select('id, manual_ref, source')
          .in('id', txTargetIds);
        (txData || []).forEach((t: any) => {
          txLabelMap[t.id] = t.source === 'manual' && t.manual_ref ? `BIR ${t.manual_ref}` : 'Term sale';
        });
      }

      const collected: CollectionRow[] = (collData || []).map((p: any) => ({
        id: p.id,
        customer_name: customerMap.get(p.customer_id) || 'Unknown',
        collector: collectorMap.get(p.cashier_id) || 'Admin',
        amount: Number(p.amount || 0),
        payment_method: p.payment_method,
        reference_number: p.reference_number || null,
        created_at: p.created_at,
        allocations: (p.term_payment_allocations || []).map((a: any) => ({
          transaction_id: a.transaction_id,
          amount: Number(a.amount || 0),
        })),
        target_labels: (p.term_payment_allocations || []).map(
          (a: any) => txLabelMap[a.transaction_id] || 'Term sale'
        ),
      }));
      setCollections(collected);
      setError(null);
    } catch (err: any) {
      console.error('Error loading down payments:', err);
      setError(err.message || 'Failed to load down payments');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.startIso, period.endIso]);

  const openAccounts = useMemo(() => accounts.filter((a) => a.outstanding > 0), [accounts]);
  const overdueCount = useMemo(
    () => openAccounts.filter((a) => isOverdueRow(a)).length,
    [openAccounts]
  );
  const totalOutstanding = useMemo(
    () => openAccounts.reduce((sum, a) => sum + a.outstanding, 0),
    [openAccounts]
  );
  const collectedTotal = useMemo(
    () => collections.reduce((sum, c) => sum + c.amount, 0),
    [collections]
  );

  const filteredAccounts = useMemo(() => {
    switch (filter) {
      case 'open':
        return openAccounts;
      case 'overdue':
        return openAccounts.filter((a) => isOverdueRow(a));
      case 'paid':
        return accounts.filter((a) => a.outstanding <= 0);
      default:
        return accounts;
    }
  }, [accounts, openAccounts, filter]);

  useEffect(() => {
    if (!isRecordOpen || !custQuery.trim()) {
      setCustResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name')
        .ilike('name', `%${custQuery.trim()}%`)
        .order('name')
        .limit(10);
      setCustResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [custQuery, isRecordOpen]);

  const resetRecordState = () => {
    setCustQuery('');
    setCustResults([]);
    setRecCustomer(null);
    setOutstanding([]);
    setRecAmount('');
    setRecMethod('cash');
    setRecReference('');
    setRecNotes('');
    setRecError(null);
  };

  const openRecordModal = () => {
    resetRecordState();
    setIsRecordOpen(true);
  };

  const closeRecordModal = () => {
    if (isSaving) return;
    setIsRecordOpen(false);
    resetRecordState();
  };

  // Success path: isSaving is still true here, so bypass the in-progress guard.
  const closeAfterSave = () => {
    setIsRecordOpen(false);
    resetRecordState();
  };

  const selectCustomer = async (customer: { id: string; name: string }) => {
    setRecCustomer(customer);
    setCustQuery(customer.name);
    setCustResults([]);
    setOutstanding([]);
    setRecAmount('');
    setRecReference('');
    setRecError(null);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select(
          'id, total_amount, term_remaining_balance, term_paid_amount, transaction_date, source, manual_ref'
        )
        .eq('customer_id', customer.id)
        .eq('payment_method', 'term')
        .eq('status', 'completed')
        .is('voided_at', null)
        .order('transaction_date', { ascending: true });
      if (error) throw error;

      const buckets: OutstandingBucket[] = (data || [])
        .filter(
          (tx: any) =>
            (Number(tx.term_paid_amount) || 0) <
            (Number(tx.term_remaining_balance) || Number(tx.total_amount))
        )
        .map((tx: any) => ({
          id: tx.id,
          label: tx.manual_ref ? `BIR ${tx.manual_ref}` : 'Term sale',
          owed: (Number(tx.term_remaining_balance) || Number(tx.total_amount) || 0) - (Number(tx.term_paid_amount) || 0),
          total_amount: Number(tx.total_amount || 0),
          term_remaining_balance: Number(tx.term_remaining_balance || tx.total_amount || 0),
          term_paid_amount: Number(tx.term_paid_amount || 0),
        }));

      const { data: custData } = await supabase
        .from('customers')
        .select('balance_override')
        .eq('id', customer.id)
        .single();
      const override = Number((custData as any)?.balance_override || 0);
      if (override > 0) {
        buckets.unshift({
          id: 'balance_override',
          label: 'Unlinked balance',
          owed: override,
          total_amount: override,
          term_remaining_balance: override,
          term_paid_amount: 0,
        });
      }

      setOutstanding(buckets);
    } catch (err: any) {
      console.error('Error fetching customer outstanding:', err);
      setRecError(err.message || 'Failed to load customer balances');
    }
  };

  const totalOwed = useMemo(
    () => outstanding.reduce((sum, b) => sum + Math.max(0, b.owed), 0),
    [outstanding]
  );

  const preview = useMemo(() => {
    let remaining = parseFloat(recAmount) || 0;
    return outstanding.map((b) => {
      const alloc = Math.min(remaining, Math.max(0, b.owed));
      remaining -= alloc;
      return { ...b, allocated: alloc };
    });
  }, [outstanding, recAmount]);

  const submitPayment = async () => {
    try {
      setRecError(null);
      if (!recCustomer) throw new Error('Please select a customer.');
      const amount = parseFloat(recAmount);
      if (!amount || amount <= 0) throw new Error('Please enter a valid payment amount.');
      if (METHODS_REQUIRING_REFERENCE.includes(recMethod) && !recReference.trim()) {
        throw new Error(`A reference number is required for ${recMethod} payments.`);
      }
      if (amount > totalOwed) {
        throw new Error(`Payment amount (${formatPrice(amount)}) exceeds outstanding balance (${formatPrice(totalOwed)}).`);
      }

      setIsSaving(true);
      const { data: paymentData, error: paymentError } = await supabase
        .from('term_payments')
        .insert({
          customer_id: recCustomer.id,
          cashier_id: null,
          amount,
          payment_method: recMethod,
          reference_number: METHODS_REQUIRING_REFERENCE.includes(recMethod) ? recReference.trim() : null,
          notes: recNotes.trim() || null,
        })
        .select()
        .single();
      if (paymentError) throw paymentError;

      let remaining = amount;
      for (const bucket of outstanding) {
        if (remaining <= 0) break;
        const owed = Math.max(0, bucket.owed);
        const alloc = Math.min(remaining, owed);
        if (alloc <= 0) continue;

        if (bucket.id === 'balance_override') {
          const { error: overrideError } = await supabase
            .from('customers')
            .update({ balance_override: owed - alloc })
            .eq('id', recCustomer.id);
          if (overrideError) throw overrideError;
        } else {
          const { error: allocError } = await supabase
            .from('term_payment_allocations')
            .insert({ term_payment_id: paymentData.id, transaction_id: bucket.id, amount: alloc });
          if (allocError) throw allocError;

          const newPaid = bucket.term_paid_amount + alloc;
          const { error: updateError } = await supabase.rpc('update_transaction_term_paid_amount', {
            p_transaction_id: bucket.id,
            p_term_paid_amount: newPaid,
          });
          if (updateError) throw updateError;
        }
        remaining -= alloc;
      }

      closeAfterSave();
      await load();
      onRecorded?.();
    } catch (err: any) {
      console.error('Failed to record down payment:', err);
      setRecError(err.message || 'Failed to record payment');
    } finally {
      setIsSaving(false);
    }
  };

  const undoPayment = async () => {
    if (!pendingUndo) return;
    try {
      setError(null);
      setIsUndoing(true);
      const { error: rpcError } = await supabase.rpc('undo_term_payment', {
        p_payment_id: pendingUndo.id,
      });
      if (rpcError) throw rpcError;
      setPendingUndo(null);
      await load();
      onRecorded?.();
    } catch (err: any) {
      console.error('Failed to undo payment:', err);
      setError(err.message || 'Failed to undo payment');
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <section className="space-y-6">
      {/* Section header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white dark:bg-gray-900 px-6 py-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <HandCoins className="h-6 w-6 text-primary" />
            Down Payments
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor term accounts, record collections, and undo mistakes. Outstanding balances are all-time;
            collections follow the report period above.
          </p>
        </div>
        <Button onClick={openRecordModal} className="shrink-0">
          <HandCoins className="h-4 w-4" />
          Record Payment
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MiniStat
          title="Total Outstanding"
          value={formatPrice(totalOutstanding)}
          sub={`${openAccounts.length} open account${openAccounts.length === 1 ? '' : 's'}`}
          icon={<Wallet className="h-5 w-5 text-green-500" />}
          loading={isLoading}
        />
        <MiniStat
          title="Collected (period)"
          value={formatPrice(collectedTotal)}
          sub={`${collections.length} payment${collections.length === 1 ? '' : 's'}`}
          icon={<HandCoins className="h-5 w-5 text-blue-500" />}
          loading={isLoading}
        />
        <MiniStat
          title="Overdue"
          value={overdueCount.toString()}
          sub={overdueCount > 0 ? `${formatPrice(openAccounts.filter((a) => isOverdueRow(a)).reduce((s, a) => s + a.outstanding, 0))} past due` : 'All within due date'}
          icon={<Calendar className="h-5 w-5 text-orange-500" />}
          loading={isLoading}
        />
        <MiniStat
          title="Down Payments Taken"
          value={formatPrice(accounts.reduce((s, a) => s + a.down_payment, 0))}
          sub="Initial down payments on term sales"
          icon={<ReceiptText className="h-5 w-5 text-purple-500" />}
          loading={isLoading}
        />
      </div>

      {/* Open accounts */}
      <Card className="shadow-sm border-gray-100 dark:border-gray-800 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 bg-gray-50/50 dark:bg-gray-800/50 border-b">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-semibold">Term Accounts</h3>
          </div>
          <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
            {(
              [
                { key: 'open', label: `Open (${openAccounts.length})` },
                { key: 'overdue', label: `Overdue (${overdueCount})` },
                { key: 'paid', label: 'Paid' },
                { key: 'all', label: 'All' },
              ] as const
            ).map((t) => (
              <Button
                key={t.key}
                variant={filter === t.key ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter(t.key)}
                className={`rounded-lg ${filter === t.key ? 'shadow-sm' : ''}`}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <CalendarDays className="h-12 w-12 mb-4 opacity-20" />
              <p>No term accounts in this view</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50 dark:bg-gray-900/50">
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="w-[120px]">Due Date</TableHead>
                    <TableHead className="w-[100px]">Source</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Down</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((a) => (
                    <TableRow key={a.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                            {a.customer_name.substring(0, 2).toUpperCase() || '??'}
                          </div>
                          <span className="truncate max-w-[160px]">{a.customer_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                        {a.term_due_date ? formatDate(a.term_due_date) : '-'}
                      </TableCell>
                      <TableCell>
                        {a.source === 'manual' ? (
                          <Badge
                            variant="outline"
                            className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800 text-[10px] font-black uppercase"
                            title={a.manual_ref ? `BIR ${a.manual_ref}` : undefined}
                          >
                            Manual
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800 text-[10px] font-black uppercase"
                          >
                            Register
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{formatPrice(a.total_amount)}</TableCell>
                      <TableCell className="text-right">{formatPrice(a.down_payment)}</TableCell>
                      <TableCell className="text-right">{formatPrice(a.term_paid_amount)}</TableCell>
                      <TableCell className="text-right font-bold text-gray-900 dark:text-white">
                        {formatPrice(a.outstanding)}
                      </TableCell>
                      <TableCell>
                        {a.outstanding <= 0 ? (
                          <Badge className="text-green-700 border-green-200 bg-green-50 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800">
                            Paid
                          </Badge>
                        ) : isOverdueRow(a) ? (
                          <Badge className="text-red-700 border-red-200 bg-red-50 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800">
                            Overdue
                          </Badge>
                        ) : (
                          <Badge variant="outline">Open</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collections */}
      <Card className="shadow-sm border-gray-100 dark:border-gray-800 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between bg-gray-50/50 dark:bg-gray-800/50 border-b">
          <div className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-semibold">Collections</h3>
          </div>
          <span className="text-sm text-muted-foreground">
            {formatPrice(collectedTotal)} within period
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : collections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Calendar className="h-12 w-12 mb-4 opacity-20" />
              <p>No collections recorded in this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50 dark:bg-gray-900/50">
                  <TableRow>
                    <TableHead className="w-[130px]">Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Collected By</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Allocated To</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((c) => (
                    <TableRow key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                        {formatDateTime(c.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">{c.customer_name}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm">
                          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                          {c.collector}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize flex w-fit items-center px-2 py-0.5">
                          {getMethodIcon(c.payment_method)}
                          {c.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs text-gray-500 max-w-[220px]">
                          {c.target_labels.length > 0 ? c.target_labels.join(', ') : '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-gray-900 dark:text-white">
                        {formatPrice(c.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                          title="Undo payment"
                          onClick={() => setPendingUndo(c)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record payment modal */}
      <Modal
        isOpen={isRecordOpen}
        onClose={closeRecordModal}
        title="Record Down Payment"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeRecordModal} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={submitPayment} disabled={isSaving}>
              {isSaving ? 'Recording...' : 'Record Payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Customer
            </label>
            <div className="relative">
              <input
                type="text"
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer..."
                className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-4 py-2 pr-10 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
              <Search className="h-4 w-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
              {custResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700">
                  {custResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 first:rounded-t-xl last:rounded-b-xl"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {recCustomer && (
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="font-semibold">{recCustomer.name}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total outstanding</p>
                <p className="font-bold text-primary">{formatPrice(totalOwed)}</p>
              </div>
            </div>
          )}

          {outstanding.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Allocation Preview
              </p>
              {preview.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{b.label}</p>
                    <p className="text-[11px] text-muted-foreground">Owed {formatPrice(b.owed)}</p>
                  </div>
                  {b.allocated > 0 ? (
                    <Badge className="text-green-700 border-green-200 bg-green-50 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800">
                      {formatPrice(b.allocated)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Amount
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={recAmount}
                onChange={(e) => setRecAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Payment Method
              </label>
              <select
                value={recMethod}
                onChange={(e) => setRecMethod(e.target.value)}
                className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile">Mobile</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>

          {METHODS_REQUIRING_REFERENCE.includes(recMethod) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Reference Number
              </label>
              <input
                type="text"
                value={recReference}
                onChange={(e) => setRecReference(e.target.value)}
                placeholder="Required for this payment method"
                className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Notes
            </label>
            <textarea
              value={recNotes}
              onChange={(e) => setRecNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
              className="w-full bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary outline-none resize-none"
            />
          </div>

          {recError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              {recError}
            </div>
          )}
        </div>
      </Modal>

      {/* Undo confirmation */}
      <Modal
        isOpen={!!pendingUndo}
        onClose={() => !isUndoing && setPendingUndo(null)}
        title="Undo Payment"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingUndo(null)} disabled={isUndoing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={undoPayment} disabled={isUndoing}>
              {isUndoing ? 'Undoing...' : 'Undo Payment'}
            </Button>
          </>
        }
      >
        {pendingUndo && (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              <p>
                This reverses the {formatPrice(pendingUndo.amount)} payment from{' '}
                {pendingUndo.customer_name} and restores the outstanding balances on the affected
                accounts. This cannot be undone.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function MiniStat({
  title,
  value,
  sub,
  icon,
  loading,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card className="shadow-sm border-gray-100 dark:border-gray-800">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-500 flex items-center gap-1.5">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <h3 className="text-2xl font-bold tracking-tight">{value}</h3>
            )}
            {sub && !loading && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function isOverdueRow(a: AccountRow) {
  if (a.outstanding <= 0 || !a.term_due_date) return false;
  const due = a.term_due_date.includes('T') ? a.term_due_date.slice(0, 10) : a.term_due_date;
  const [year, month, day] = due.split('-').map(Number);
  if (!year || !month || !day) return false;
  const dueDate = new Date(year, month - 1, day);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate < new Date();
}

function formatDate(dateStr: string) {
  const due = dateStr.includes('T') ? dateStr.slice(0, 10) : dateStr;
  return new Date(due).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function getMethodIcon(method: string) {
  switch ((method || '').toLowerCase()) {
    case 'cash':
      return <Banknote className="h-4 w-4 mr-1" />;
    case 'gcash':
    case 'mobile':
      return <Smartphone className="h-4 w-4 mr-1" />;
    case 'card':
      return <CreditCard className="h-4 w-4 mr-1" />;
    case 'cheque':
      return <ScrollText className="h-4 w-4 mr-1" />;
    case 'term':
      return <CalendarDays className="h-4 w-4 mr-1" />;
    case 'downpayment':
    case 'term_payment':
      return <HandCoins className="h-4 w-4 mr-1" />;
    default:
      return <Wallet className="h-4 w-4 mr-1" />;
  }
}