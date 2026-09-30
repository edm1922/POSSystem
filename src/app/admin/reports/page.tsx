'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useCurrency } from '@/context/CurrencyContext';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import DownpaymentsSection from '@/components/admin/DownpaymentsSection';
import {
  TrendingUp,
  ShoppingCart,
  Wallet,
  Calendar,
  History,
  FileText,
  DollarSign,
  ArrowUpRight,
  CreditCard,
  Banknote,
  CalendarDays,
  HandCoins,
  Smartphone,
  ScrollText,
  Layers
} from 'lucide-react';

interface Transaction {
  id: string;
  cashier_id: string;
  recorded_by_cashier_id?: string;
  total_amount: number;
  down_payment?: number;
  payment_method: string;
  status?: string;
  created_at: string;
  transaction_date?: string;
  source?: 'register' | 'manual';
  manual_ref?: string;
  voided_at?: string;
  customer_id?: string;
  customer_name?: string;
  is_down_payment?: boolean;
  cashier?: { email: string };
  transaction_items?: Array<{
    quantity: number;
    item_name?: string;
    products?: { name: string };
  }>;
}

type DateRange = 'today' | 'week' | 'month' | 'year' | 'custom';
type SourceFilter = 'combined' | 'register' | 'manual';

// Shared window helper: the report ledger and the Down Payments monitor both
// need the exact same period so their "collected" figures agree.
function getReportWindow(
  range: DateRange,
  customStartDate: string,
  customEndDate: string
): { startIso: string; endIso: string | null } {
  const now = new Date();
  let startDate = new Date();
  let endIso: string | null = null;

  if (range === 'custom') {
    const endDate = new Date(customEndDate);
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(customStartDate);
    startDate.setHours(0, 0, 0, 0);
    endIso = endDate.toISOString();
  } else {
    switch (range) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }
  }

  return { startIso: startDate.toISOString(), endIso };
}

export default function Reports() {
  const { formatPrice } = useCurrency();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('week');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('combined');
  const [customStartDate, setCustomStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);

  const reportWindow = useMemo(
    () => getReportWindow(dateRange, customStartDate, customEndDate),
    [dateRange, customStartDate, customEndDate]
  );

  useEffect(() => {
    fetchData();
  }, [dateRange, customStartDate, customEndDate, sourceFilter]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { startIso, endIso } = reportWindow;

      let query = supabase
        .from('transactions')
        .select('*, transaction_items(quantity, item_name, products(name))')
        .eq('status', 'completed')
        .is('voided_at', null)
        .gte('transaction_date', startIso);

      if (endIso) query = query.lte('transaction_date', endIso);
      if (sourceFilter !== 'combined') query = query.eq('source', sourceFilter);

      const { data: transactionsData, error: transactionsError } = await query
        .order('transaction_date', { ascending: false })
        .limit(500);

      if (transactionsError) throw transactionsError;

      const startDate = new Date(startIso);
      await processAndSetTransactions(
        transactionsData,
        startDate,
        endIso ? new Date(endIso) : undefined
      );
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const processAndSetTransactions = async (transactionsData: any[] | null, startDate: Date, endDate?: Date) => {
    // Fetch all cashiers and users to map them manually
    const [ { data: cashiersData }, { data: usersData }, { data: customersData } ] = await Promise.all([
      supabase.from('cashiers').select('id, username, email'),
      supabase.from('users').select('id, email'),
      supabase.from('customers').select('id, name')
    ]);

    const cashierMap = new Map();
    (cashiersData || []).forEach(c => cashierMap.set(c.id, c.username || c.email));
    (usersData || []).forEach(u => cashierMap.set(u.id, u.email));

    const customerMap = new Map();
    (customersData || []).forEach(c => customerMap.set(c.id, c.name));

    // Fetch term payments (downpayments) in the same range
    let termQuery = supabase
      .from('term_payments')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });
    if (endDate) termQuery = termQuery.lte('created_at', endDate.toISOString());
    const { data: termPayments } = await termQuery;

    const rows = buildReportRows(transactionsData || [], termPayments || [], cashierMap, customerMap);
    setTransactions(rows);
  };

  const buildReportRows = (
    transactionsData: any[],
    termPayments: any[],
    cashierMap: Map<any, any>,
    customerMap: Map<any, any>
  ): Transaction[] => {
    const rows: Transaction[] = [];

    for (const t of transactionsData) {
      const isTerm = t.payment_method === 'term';
      const downPayment = Number(t.down_payment || 0);
      if (isTerm && downPayment <= 0) continue;

      // Manual entries have no cashier_id by design; attribute them to the
      // cashier who keyed them in so the column never reads "System".
      const attributedTo = t.source === 'manual' ? t.recorded_by_cashier_id : t.cashier_id;

      rows.push({
        ...t,
        total_amount: isTerm ? downPayment : Number(t.total_amount || 0),
        source: t.source || 'register',
        transaction_date: t.transaction_date || t.created_at,
        cashier: { email: cashierMap.get(attributedTo) || 'System' },
        customer_name: t.customer_id ? customerMap.get(t.customer_id) || 'Unknown' : t.customer_name
      });
    }

    for (const p of termPayments) {
      rows.push({
        id: p.id,
        cashier_id: p.cashier_id,
        total_amount: p.amount,
        payment_method: 'downpayment',
        status: 'completed',
        created_at: p.created_at,
        transaction_date: p.created_at,
        source: 'register',
        cashier: { email: cashierMap.get(p.cashier_id) || 'System' },
        customer_name: customerMap.get(p.customer_id) || 'Unknown',
        is_down_payment: true
      });
    }

    return rows.sort((a, b) => new Date(b.transaction_date || b.created_at).getTime() - new Date(a.transaction_date || a.created_at).getTime());
  };

  const getItemLabel = (item: { quantity: number; item_name?: string; products?: { name: string } }) => {
    // Manual book lines can be free text with no linked product, so item_name is
    // the only reliable label for those.
    const name = item.item_name || item.products?.name || 'Item';
    return `${item.quantity}x ${name}`;
  };

  const getTransactionDate = (t: Transaction) => t.transaction_date || t.created_at;

  const stats = useMemo(() => {
    const totalSales = transactions.reduce((sum, t) => sum + Number(t.total_amount || 0), 0);
    const count = transactions.length;
    const avg = count > 0 ? totalSales / count : 0;
    const highest = transactions.reduce((max, t) => {
      const amount = Number(t.total_amount || 0);
      return amount > max ? amount : max;
    }, 0);

    const registerSales = transactions.reduce((sum, t) => sum + (t.source === 'manual' ? 0 : Number(t.total_amount || 0)), 0);
    const manualSales = transactions.reduce((sum, t) => sum + (t.source === 'manual' ? Number(t.total_amount || 0) : 0), 0);
    const manualCount = transactions.filter((t) => t.source === 'manual').length;

    // Payment method breakdown
    const methods = transactions.reduce((acc, t) => {
      const amount = Number(t.total_amount || 0);
      acc[t.payment_method] = (acc[t.payment_method] || 0) + amount;
      return acc;
    }, {} as Record<string, number>);

    return { totalSales, count, avg, highest, methods, registerSales, manualSales, manualCount };
  }, [transactions]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (dateRange === 'today') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getMethodIcon = (method: string) => {
    switch (method.toLowerCase()) {
      case 'cash': return <Banknote className="h-4 w-4 mr-1" />;
      case 'gcash':
      case 'mobile': return <Smartphone className="h-4 w-4 mr-1" />;
      case 'card': return <CreditCard className="h-4 w-4 mr-1" />;
      case 'cheque': return <ScrollText className="h-4 w-4 mr-1" />;
      case 'term': return <CalendarDays className="h-4 w-4 mr-1" />;
      case 'downpayment':
      case 'term_payment': return <HandCoins className="h-4 w-4 mr-1" />;
      default: return <Wallet className="h-4 w-4 mr-1" />;
    }
  };

  const exportToCSV = () => {
    if (transactions.length === 0) return;

    const headers = ['Date', 'Source', 'BIR Serial', 'Cashier', 'Products', 'Payment Method', 'Total Amount', 'Status'];

    const rows = transactions.map(t => [
      new Date(getTransactionDate(t)).toLocaleString(),
      t.source === 'manual' ? 'Manual Book' : 'Register',
      t.manual_ref || '',
      t.cashier?.email || 'System',
      t.is_down_payment
        ? `Downpayment from ${t.customer_name || 'Unknown'}`
        : t.transaction_items?.map(getItemLabel).join('; ') || '',
      t.payment_method,
      t.total_amount.toString(),
      t.status || 'Completed'
    ]);
    
    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `sales-report-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-8 w-8 text-primary" />
            Sales Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitoring business performance and transaction history.
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-2">
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 mr-2 animate-in slide-in-from-right duration-300">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
              <span className="text-xs font-bold text-muted-foreground uppercase">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-gray-100 dark:bg-gray-800 border-none rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          )}
          <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
            {(['today', 'week', 'month', 'year', 'custom'] as const).map(range => (
              <Button
                key={range}
                variant={dateRange === range ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDateRange(range)}
                className={`rounded-lg transition-all ${dateRange === range ? 'shadow-sm' : ''}`}
              >
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Source filter: register vs manual book vs combined */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-gray-900 px-6 py-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
        <div>
          <p className="text-sm font-black flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Sales Source
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Manual book entries are dated by their BIR receipt date.
          </p>
        </div>
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl self-start">
          {([
            { key: 'register', label: 'Register' },
            { key: 'manual', label: 'Manual Book' },
            { key: 'combined', label: 'Combined' },
          ] as const).map(s => (
            <Button
              key={s.key}
              variant={sourceFilter === s.key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSourceFilter(s.key)}
              className={`rounded-lg ${sourceFilter === s.key ? 'shadow-sm' : ''}`}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Money Collected"
          value={formatPrice(stats.totalSales)}
          icon={<DollarSign className="h-5 w-5 text-green-500" />}
          loading={isLoading}
          trend={`Register ${formatPrice(stats.registerSales)} · Manual ${formatPrice(stats.manualSales)}`}
          trendColor="text-muted-foreground"
        />
        <StatCard
          title="Transactions"
          value={stats.count.toString()}
          icon={<ShoppingCart className="h-5 w-5 text-blue-500" />}
          loading={isLoading}
        />
        <StatCard
          title="Average Spend"
          value={formatPrice(stats.avg)}
          icon={<TrendingUp className="h-5 w-5 text-orange-500" />}
          loading={isLoading}
        />
        <StatCard
          title="Highest Sale"
          value={formatPrice(stats.highest)}
          icon={<ArrowUpRight className="h-5 w-5 text-purple-500" />}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Table Container */}
        <Card className="lg:col-span-2 shadow-sm border-gray-100 dark:border-gray-800 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between bg-gray-50/50 dark:bg-gray-800/50 border-b">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-gray-500" />
              <h3 className="text-lg font-semibold">Recent Transactions</h3>
            </div>
            <FileText 
              className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-primary transition-colors" 
              onClick={exportToCSV}
            />
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-4">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50 dark:bg-gray-900/50">
                    <TableRow>
                      <TableHead className="w-[180px]">Date & Time</TableHead>
                      <TableHead className="w-[110px]">Source</TableHead>
                      <TableHead>Cashier</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.slice(0, 50).map((t) => (
                      <TableRow key={t.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                        <TableCell className="font-medium text-gray-600 dark:text-gray-400">
                          {formatDate(getTransactionDate(t))}
                        </TableCell>
                        <TableCell>
                          {t.source === 'manual' ? (
                            <Badge
                              variant="outline"
                              className="text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800 text-[10px] font-black uppercase"
                              title={t.manual_ref ? `BIR ${t.manual_ref}` : undefined}
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
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                              {t.cashier?.email.substring(0, 2).toUpperCase() || '??'}
                            </div>
                            <span className="truncate max-w-[150px]">{t.cashier?.email || 'System'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {t.is_down_payment ? (
                            <div className="text-xs text-gray-500 max-w-[200px] truncate" title={t.customer_name}>
                              <span className="font-bold text-gray-700 dark:text-gray-300">Downpayment from</span> {t.customer_name}
                            </div>
                          ) : (
                            <div
                              className="text-xs text-gray-500 max-w-[200px] truncate"
                              title={t.transaction_items?.map(getItemLabel).join(', ') || ''}
                            >
                              {t.transaction_items?.map(getItemLabel).join(', ') || '-'}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize flex w-fit items-center px-2 py-0.5">
                            {getMethodIcon(t.payment_method)}
                            {t.payment_method}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold text-gray-900 dark:text-white">
                          {formatPrice(t.total_amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {transactions.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Calendar className="h-12 w-12 mb-4 opacity-20" />
                    <p>No transactions found for this period</p>
                  </div>
                )}
                {transactions.length > 50 && (
                  <div className="p-4 text-center border-t border-gray-100 dark:border-gray-800">
                    <p className="text-sm text-muted-foreground">
                      Showing last 50 of {transactions.length} transactions.
                      <Button variant="link" size="sm" className="ml-1" onClick={exportToCSV}>View all details</Button>
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar Summaries */}
        <div className="space-y-6">
          <Card className="shadow-sm border-gray-100 dark:border-gray-800">
            <CardHeader className="bg-gray-50/50 dark:bg-gray-800/50 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Wallet className="h-5 w-5 text-gray-500" />
                Method Breakdown
              </h3>
            </CardHeader>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : Object.keys(stats.methods).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(stats.methods).map(([method, amount]) => (
                    <div key={method} className="group">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium capitalize flex items-center">
                          {getMethodIcon(method)}
                          {method}
                        </span>
                        <span className="text-sm font-bold">{formatPrice(amount)}</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`bg-primary h-full transition-all duration-1000 ease-out`}
                          style={{ width: `${stats.totalSales > 0 ? (amount / stats.totalSales) * 100 : 0}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-right text-muted-foreground mt-1">
                        {((amount / (stats.totalSales || 1)) * 100).toFixed(1)}% of total
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm italic">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-primary text-primary-foreground shadow-lg border-none overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <TrendingUp className="h-24 w-24" />
            </div>
            <CardContent className="pt-6 relative z-10">
              <p className="text-primary-foreground/80 text-sm font-medium">Business Performance</p>
              <h4 className="text-xl font-bold mt-1">Steady Growth</h4>
              <p className="text-xs mt-4 leading-relaxed opacity-90">
                You've processed <strong>{stats.count} transactions</strong> in the selected period, with a total volume of <strong>{formatPrice(stats.totalSales)}</strong>.
              </p>
              <Button 
                variant="secondary" 
                className="w-full mt-6 bg-white text-primary hover:bg-gray-100 font-semibold shadow-sm"
                onClick={exportToCSV}
              >
                Generate Full Analysis
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Down Payments monitor */}
      <DownpaymentsSection period={reportWindow} onRecorded={fetchData} />
    </div>
  );
}

function StatCard({ title, value, icon, loading, trend, trendColor = "text-muted-foreground" }: any) {
  return (
    <Card className="hover:shadow-md transition-all duration-300 border-gray-100 dark:border-gray-800 overflow-hidden relative">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
              {title}
            </p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <h3 className="text-2xl font-bold tracking-tight">{value}</h3>
            )}
            {trend && !loading && (
              <p className={`text-[10px] font-medium ${trendColor} flex items-center mt-1`}>
                <ArrowUpRight className="h-3 w-3 mr-0.5" />
                {trend}
              </p>
            )}
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl group">
            {icon}
          </div>
        </div>
      </CardContent>
      <div className="absolute bottom-0 left-0 w-full h-[3px] bg-gradient-to-r from-transparent via-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </Card>
  );
}
