'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseAuth, supabaseDB } from '@/lib/supabaseClient';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription
} from '@/components/ui/Card';
import { useCurrency } from '@/context/CurrencyContext';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PRODUCT_CATEGORIES } from '@/lib/constants';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search,
  Barcode,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Settings,
  LogOut,
  Box,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  CreditCard,
  Wallet,
  Monitor,
  Landmark,
  CalendarDays,
  Check,
  FileText,
  HandCoins,
  Banknote,
  ChevronDown,
  Printer,
  Users,
  Pencil,
  UserPlus
} from 'lucide-react';
import { PrintableReceipt } from '@/components/ui/PrintableReceipt';
import { DailyReportModal } from '@/components/cashier/DailyReportModal';
import { ManualEntryModal } from '@/components/cashier/ManualEntryModal';

interface Product {
  id: string;
  name: string;
  price: number;
  barcode?: string;
  category?: string;
  stock_quantity: number;
  image_url?: string;
  created_at: string;
}

export default function CashierPOS() {
  const { formatPrice } = useCurrency();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const [cart, setCart] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDailyReportOpen, setIsDailyReportOpen] = useState(false);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false); // BIR manual sales book entry
  const [pendingManualCount, setPendingManualCount] = useState(0);
  const [isCartOpen, setIsCartOpen] = useState(false); // For mobile cart drawer
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile' | 'cheque' | 'term'>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [transactionComplete, setTransactionComplete] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null); // For success notifications
  const [barcodeValue, setBarcodeValue] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [downPaymentPercent, setDownPaymentPercent] = useState(20);
  const [termDays, setTermDays] = useState(30);
  const [deliveredTo, setDeliveredTo] = useState('');
  const [tin, setTin] = useState('');
  const [orNumber, setOrNumber] = useState('');
  const [showSignatures, setShowSignatures] = useState(true);
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [rpCustomerName, setRpCustomerName] = useState('');
  const [rpCustomers, setRpCustomers] = useState<{id: string; name: string}[]>([]);
  const [rpSelectedCustomer, setRpSelectedCustomer] = useState<{id: string; name: string} | null>(null);
  const [rpAmount, setRpAmount] = useState('');
  const [rpPaymentMethod, setRpPaymentMethod] = useState<'cash' | 'card' | 'mobile' | 'cheque'>('cash');
  const [rpReferenceNumber, setRpReferenceNumber] = useState('');
  const [rpOutstanding, setRpOutstanding] = useState<any[]>([]);
  const [rpLoading, setRpLoading] = useState(false);
  const [rpPreview, setRpPreview] = useState<Array<{tx: any; allocated: number}>>([]);
  const [rpTxItems, setRpTxItems] = useState<Record<string, string[]>>({});
  const [rpNotes, setRpNotes] = useState('');
  const [rpCustomerBalanceOverride, setRpCustomerBalanceOverride] = useState(0);
  const [termReceiptData, setTermReceiptData] = useState<any>(null);
  const [isTermReceiptOpen, setIsTermReceiptOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'sale' | 'term' | null>(null);
  const [termCustSearch, setTermCustSearch] = useState('');
  const [termCustResults, setTermCustResults] = useState<{id: string; name: string}[]>([]);
  const [termCustSelected, setTermCustSelected] = useState<{id: string; name: string} | null>(null);
  const [termCustOutstanding, setTermCustOutstanding] = useState(0);

  const [isCustomerListOpen, setIsCustomerListOpen] = useState(false);
  const [customerListData, setCustomerListData] = useState<any[]>([]);
  const [customerListLoading, setCustomerListLoading] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isCustomerFormOpen, setIsCustomerFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [cfName, setCfName] = useState('');
  const [cfAddress, setCfAddress] = useState('');
  const [cfTinNumber, setCfTinNumber] = useState('');
  const [cfBalanceOverride, setCfBalanceOverride] = useState('0');
  const [cfSaving, setCfSaving] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const afterPrint = () => setPrintMode(null);
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);

  useEffect(() => {
    const checkUser = async () => {
      const { data: sessionData, error: sessionError } = await supabaseAuth.getSession();

      // Check for our custom cashier session
      const cashierSession = typeof window !== 'undefined' ? localStorage.getItem('cashier_session') : null;
      const cashierId = typeof window !== 'undefined' ? sessionStorage.getItem('cashier_id') : null;
      const cashierUsername = typeof window !== 'undefined' ? sessionStorage.getItem('cashier_username') : null;

      if ((!sessionData?.session && !cashierSession) || !cashierId || !cashierUsername) {
        if (typeof window !== 'undefined') {
          window.location.href = '/auth/cashier/login';
        }
        return;
      }

      // Add cashier info to the user object
      const userWithCashierInfo = {
        ...(sessionData?.session?.user || { id: 'cashier', email: 'cashier@pos-system.local' }),
        cashier_id: cashierId,
        cashier_username: cashierUsername
      };

      setUser(userWithCashierInfo);
      setLoading(false);
    };

    checkUser();
  }, [router]);

  useEffect(() => {
    // Fetch products and settings from Supabase
    fetchProducts();
    fetchSettings();
    fetchPendingManualCount();

    // Set up real-time listener for product updates
    const channel = supabase
      .channel('products-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'products'
        },
        (payload) => {
          console.log('Product change detected:', payload);
          if (payload.eventType === 'UPDATE') {
            const updatedProduct = payload.new as Product & { deleted_at?: string | null };
            
            // If the product was soft-deleted, remove it from the list
            if (updatedProduct.deleted_at) {
              setProducts((currentProducts) => 
                currentProducts.filter((p) => p.id !== updatedProduct.id)
              );
            } else {
              // Otherwise update it in the list
              setProducts((currentProducts) =>
                currentProducts.map((p) =>
                  p.id === updatedProduct.id ? (updatedProduct as Product) : p
                )
              );
            }
          } else {
            fetchProducts();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settings'
        },
        () => {
          console.log('Settings changed, reloading...');
          fetchSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabaseDB.getProducts();

      if (error) {
        throw new Error(error);
      }

      setProducts(data || []);
    } catch (error: any) {
      console.error('Error fetching products:', error);
      setError('Failed to load products. Please try again.');
    }
  };

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabaseDB.getSettings();
      if (error) throw error;
      setSettings(data);
    } catch (error: any) {
      console.error('Error fetching settings:', error);
    }
  };

  // Badge count for the MANUAL button so the cashier can see if the admin has
  // cleared their queue. Manual entries are kept entirely out of the register
  // flow, so this must never touch totals, stock, or the EOD report.
  // Cashiers hold the anon key with no Auth session, so this goes through the
  // RPC rather than a direct read of manual_entry_requests.
  const fetchPendingManualCount = useCallback(async () => {
    try {
      const cashierId = typeof window !== 'undefined' ? sessionStorage.getItem('cashier_id') : null;
      if (!cashierId) return;
      const { data, error } = await supabase.rpc('list_manual_entry_requests', {
        p_cashier_id: cashierId,
        p_status: 'pending',
      });
      if (error) throw error;
      const rows = (data as unknown[]) || [];
      setPendingManualCount(rows.length);
    } catch (err) {
      console.error('Error fetching pending manual entry count:', err);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      const { error } = await supabaseAuth.signOut();
      if (typeof window !== 'undefined') {
        localStorage.removeItem('cashier_session');
        sessionStorage.removeItem('cashier_id');
        sessionStorage.removeItem('cashier_username');
        // Clear cookie if used
        document.cookie = 'cashier_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      }
      
      if (error) {
        console.error('Sign out error:', error);
        setError(error);
      }
      
      router.push('/auth/cashier/login');
    } catch (err: any) {
      console.error('Unexpected sign out error:', err);
      router.push('/auth/cashier/login');
    }
  }, [router]);

  const addToCart = useCallback((product: Product) => {
    if (product.stock_quantity <= 0) {
      setError('Product is out of stock');
      return;
    }

    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.id === product.id);
      if (existingItem) {
        if (existingItem.quantity >= product.stock_quantity) {
          setError('Not enough stock available');
          return prevCart;
        }
        setSuccessMessage(`Added another ${product.name} to cart`);
        return prevCart.map(item =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      } else {
        setSuccessMessage(`Added ${product.name} to cart`);
        return [...prevCart, { ...product, quantity: 1 }];
      }
    });
    
    setTimeout(() => setSuccessMessage(null), 2000);
  }, []);

  const handleBarcodeSubmit = useCallback((barcode: string, source: 'barcode' | 'search' = 'barcode') => {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return;

    console.log(`[POS] Processing barcode: "${trimmedBarcode}" from source: ${source}`);

    const product = products.find(p => p.barcode === trimmedBarcode);
    if (product) {
      console.log(`[POS] Product found: ${product.name}`);
      addToCart(product);
      setSearchTerm(product.name);
      setBarcodeValue(trimmedBarcode);
      // Ensure barcode input is focused and selected for next scan
      setTimeout(() => {
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      }, 50);
    } else {
      console.log(`[POS] Product not found for barcode: ${trimmedBarcode}`);
      if (source === 'barcode') {
        setError(`Product not found for barcode: ${trimmedBarcode}`);
        setBarcodeValue('');
      }
    }
  }, [products, addToCart]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'p':
          e.preventDefault();
          if (cart.length > 0) setIsPaymentModalOpen(true);
          break;
        case 'c':
          e.preventDefault();
          if (cart.length > 0) setCart([]);
          break;
        case 'b':
          e.preventDefault();
          barcodeInputRef.current?.focus();
          break;
        case 's':
          e.preventDefault();
          handleSignOut();
          break;
        case ',':
          e.preventDefault();
          setIsSettingsModalOpen(true);
          break;
      }
    }

    if (e.key === 'Escape') {
      setIsPaymentModalOpen(false);
      setIsReceiptModalOpen(false);
      setIsSettingsModalOpen(false);
    }
  }, [cart, products, isPaymentModalOpen, isReceiptModalOpen, isSettingsModalOpen, handleSignOut]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Global barcode scanner wedge - captures scans even when no input is focused
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is already typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Clear buffer just in case
        buffer = '';
        return;
      }

      // Ignore system/modifier keys (except Shift which is used for some barcode chars)
      if (e.ctrlKey || e.altKey || e.metaKey || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }

      const now = Date.now();
      // Reset buffer if time between keystrokes is too long (manual typing vs scanner speed)
      // Hardware scanners typically send characters < 50ms apart. 500ms is a safe threshold.
      if (now - lastKeyTime > 500) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (buffer) {
          e.preventDefault();
          handleBarcodeSubmit(buffer, 'barcode');
          buffer = '';
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
        // Optional: Update UI to show characters arriving
        // setBarcodeValue(buffer);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleBarcodeSubmit]);

  const removeFromCart = (productId: string) => {
    const product = cart.find(item => item.id === productId);
    setCart(cart.filter(item => item.id !== productId));
    if (product) {
      setSuccessMessage(`Removed ${product.name} from cart`);
      setTimeout(() => setSuccessMessage(null), 2000);
    }
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity < 1) {
      removeFromCart(productId);
      return;
    }
    const product = products.find(p => p.id === productId);
    if (product && quantity > product.stock_quantity) {
      setError('Not enough stock available');
      return;
    }
    setCart(cart.map(item =>
      item.id === productId ? { ...item, quantity } : item
    ));
  };

  const calculateTotal = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const calculateChange = () => {
    if (paymentMethod === 'term') return 0;
    const raw = calculateTotal();
    const total = applyDiscount && discountAmount > 0
      ? parseFloat((raw - discountAmount).toFixed(2))
      : raw;
    const received = parseFloat(amountReceived) || 0;
    return parseFloat((received - total).toFixed(2));
  };

  const handleProcessPayment = () => {
    if (cart.length > 0) {
      setDownPaymentPercent(20);
      setTermDays(30);
      setIsPaymentModalOpen(true);
    }
  };

  const completeTransaction = async () => {
    try {
      setError(null);
      setSuccessMessage('Processing transaction...');

      const cashierId = typeof window !== 'undefined' ? sessionStorage.getItem('cashier_id') : null;
      if (!cashierId) throw new Error('Cashier information not found.');

      const { data: cashierData, error: cashierError } = await supabase
        .from('cashiers')
        .select('id, username, is_active')
        .eq('id', cashierId)
        .single();

      if (cashierError || !cashierData?.is_active) throw new Error('Cashier account error.');

      if (['card', 'mobile', 'cheque'].includes(paymentMethod) && !referenceNumber.trim()) {
        throw new Error(`A reference number is required for ${paymentMethod} payments.`);
      }

      let customerId = termCustSelected?.id || null;
      if (!customerId && customerName.trim()) {
        try {
          const { data: existingCustomer, error: lookupError } = await supabase
            .from('customers')
            .select('id')
            .eq('name', customerName.trim())
            .maybeSingle();

          if (lookupError) throw lookupError;

          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else {
            const { data: newCustomer, error: insertError } = await supabase
              .from('customers')
              .insert({ name: customerName.trim() })
              .select('id')
              .single();
            if (insertError) throw insertError;
            customerId = newCustomer?.id || null;
          }
        } catch (err) {
          console.error('Error creating/finding customer:', err);
        }
      }

      const rawTotal = calculateTotal();
      const discountAmountVal = applyDiscount && discountAmount > 0
        ? parseFloat(discountAmount.toFixed(2))
        : 0;
      const finalTotal = parseFloat((rawTotal - discountAmountVal).toFixed(2));
      const downPaymentAmount = 0;
      const termRemaining = parseFloat(finalTotal.toFixed(2));
      const termDue = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const transactionPayload: Record<string, any> = {
        cashier_id: cashierId,
        total_amount: finalTotal,
        payment_method: paymentMethod,
        reference_number: ['card', 'mobile', 'cheque'].includes(paymentMethod) ? referenceNumber : null,
        customer_id: customerId,
        discount_type: applyDiscount && discountAmount > 0 ? 'fixed' : null,
        discount_value: applyDiscount && discountAmount > 0 ? discountAmount : 0,
        discount_amount: discountAmountVal,
        status: 'completed'
      };

      if (paymentMethod === 'term') {
        transactionPayload.down_payment = 0;
        transactionPayload.term_remaining_balance = termRemaining;
        transactionPayload.term_due_date = termDue;
        transactionPayload.term_status = 'pending';
      }

      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions')
        .insert(transactionPayload)
        .select()
        .single();

      if (transactionError) throw transactionError;

      const transactionItems = cart.map(item => ({
        transaction_id: transactionData.id,
        product_id: item.id,
        quantity: item.quantity,
        price: item.price
      }));

      const { error: itemsError } = await supabase.from('transaction_items').insert(transactionItems);
      if (itemsError) throw itemsError;

      // Note: Stock deduction is now handled by the database trigger 'tr_deduct_stock_on_insert'
      // on the 'transaction_items' table. This ensures the update is atomic and secure.

      setReceiptData({
        id: transactionData.id,
        date: new Date().toISOString(),
        items: [...cart],
        total: finalTotal,
        originalTotal: rawTotal,
        discountPercent: 0,
        discountAmount: discountAmountVal,
        paymentMethod,
        referenceNumber: ['card', 'mobile', 'cheque'].includes(paymentMethod) ? referenceNumber : null,
        amountReceived: paymentMethod === 'term' ? downPaymentAmount : (parseFloat(amountReceived) || finalTotal),
        change: calculateChange(),
        downPayment: downPaymentAmount,
        remainingBalance: termRemaining,
        dueDate: termDue
      });

      setDeliveredTo(customerName);
      setCustomerName('');
      setTermCustSelected(null);
      setTermCustSearch('');
      setTermCustOutstanding(0);
      setApplyDiscount(false);
      setDiscountAmount(0);
      setDownPaymentPercent(20);
      setTermDays(30);
      setCart([]);
      setAmountReceived('');
      setReferenceNumber('');
      setIsPaymentModalOpen(false);
      setPrintMode('sale');
      setIsReceiptModalOpen(true);
      setTransactionComplete(true);
      setSuccessMessage('Transaction successful!');
      setTimeout(() => setTransactionComplete(false), 5000);
      fetchProducts();
    } catch (error: any) {
      console.error('Transaction error:', error);
      setError(error.message || 'Transaction failed.');
    }
  };

  const printReceipt = () => {
    setPrintMode('sale');
    setTimeout(() => window.print(), 50);
  };

  const cancelTransaction = async () => {
    if (!receiptData?.id) return;
    try {
      setIsReceiptModalOpen(false);
      setPrintMode(null);
      setSuccessMessage('Cancelling transaction...');
      const { error } = await supabase.rpc('undo_transaction', {
        p_transaction_id: receiptData.id
      });
      if (error) throw error;
      setSuccessMessage('Transaction cancelled successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchProducts();
    } catch (err: any) {
      console.error('Cancel transaction error:', err);
      setError('Failed to cancel transaction: ' + (err.message || 'Unknown error'));
    }
  };

  const printTermReceipt = () => {
    setPrintMode('term');
    setTimeout(() => window.print(), 50);
  };

  const cancelTermPayment = async () => {
    if (!termReceiptData?.id) return;
    try {
      setIsTermReceiptOpen(false);
      setSuccessMessage('Cancelling payment...');
      const { error } = await supabase.rpc('undo_term_payment', {
        p_payment_id: termReceiptData.id
      });
      if (error) throw error;
      setSuccessMessage('Payment cancelled successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      console.error('Cancel payment error:', err);
      setError('Failed to cancel payment: ' + (err.message || 'Unknown error'));
    }
  };

  const searchTermCustomer = async (query: string) => {
    if (!query.trim()) { setTermCustResults([]); return; }
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(10);
      if (error) throw error;
      setTermCustResults(data || []);
    } catch (err) {
      console.error('Error searching customers:', err);
    }
  };

  const selectTermCustomer = async (customer: { id: string; name: string }) => {
    setTermCustSelected(customer);
    setTermCustSearch(customer.name);
    setTermCustResults([]);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('term_remaining_balance, term_paid_amount')
        .eq('customer_id', customer.id)
        .eq('payment_method', 'term')
        .eq('status', 'completed')
        .is('voided_at', null);
      if (error) throw error;
      const totalOwed = (data || []).reduce((sum, tx) => {
        return sum + ((tx.term_remaining_balance || 0) - (tx.term_paid_amount || 0));
      }, 0);
      setTermCustOutstanding(Math.max(0, totalOwed));
    } catch (err) {
      console.error('Error fetching customer outstanding:', err);
      setTermCustOutstanding(0);
    }
  };

  const searchRpCustomers = async (query: string) => {
    if (!query.trim()) { setRpCustomers([]); return; }
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .ilike('name', `%${query}%`)
        .order('name')
        .limit(10);
      if (error) throw error;
      setRpCustomers(data || []);
    } catch (err) {
      console.error('Error searching customers:', err);
    }
  };

  const selectRpCustomer = async (customer: { id: string; name: string }) => {
    setRpSelectedCustomer(customer);
    setRpCustomerName(customer.name);
    setRpCustomers([]);
    setRpAmount('');
    setRpPreview([]);
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, total_amount, term_remaining_balance, term_paid_amount, created_at, transaction_date, source')
        .eq('customer_id', customer.id)
        .eq('payment_method', 'term')
        .eq('status', 'completed')
        .is('voided_at', null)
        .order('transaction_date', { ascending: true });
      if (error) throw error;
      const outstanding = (data || []).filter(tx => {
        const paid = tx.term_paid_amount || 0;
        const total = tx.term_remaining_balance || tx.total_amount;
        return paid < total;
      });

      const { data: custData } = await supabase
        .from('customers')
        .select('balance_override')
        .eq('id', customer.id)
        .single();
      const override = custData?.balance_override || 0;
      setRpCustomerBalanceOverride(override);
      if (override > 0) {
        outstanding.unshift({
          id: 'balance_override',
          total_amount: override,
          term_remaining_balance: override,
          term_paid_amount: 0,
          created_at: new Date().toISOString(),
          transaction_date: new Date().toISOString().split('T')[0],
          source: 'register'
        });
      }

      setRpOutstanding(outstanding);
      // Fetch product names for each transaction (skip synthetic override entry)
      const realTxIds = outstanding.filter(tx => tx.id !== 'balance_override').map(tx => tx.id);
      if (realTxIds.length > 0) {
        const { data: items, error: itemsError } = await supabase
          .from('transaction_items')
          .select('transaction_id, products(name)')
          .in('transaction_id', realTxIds);
        if (!itemsError && items) {
          const itemsMap: Record<string, string[]> = {};
          for (const item of items) {
            if (!itemsMap[item.transaction_id]) itemsMap[item.transaction_id] = [];
            const name = (item as any).products?.name;
            if (name) itemsMap[item.transaction_id].push(name);
          }
          setRpTxItems(itemsMap);
        }
      } else {
        setRpTxItems({});
      }
    } catch (err) {
      console.error('Error fetching outstanding term transactions:', err);
    }
  };

  const recalcRpPreview = (amount: string) => {
    const amt = parseFloat(amount) || 0;
    let remaining = amt;
    const preview: Array<{tx: any; allocated: number}> = [];
    for (const tx of rpOutstanding) {
      if (remaining <= 0) break;
      const owed = (tx.term_remaining_balance || tx.total_amount) - (tx.term_paid_amount || 0);
      const alloc = Math.min(remaining, owed);
      preview.push({ tx, allocated: alloc });
      remaining -= alloc;
    }
    setRpPreview(preview);
  };

  const completeTermPayment = async () => {
    try {
      setError(null);
      if (!rpSelectedCustomer) throw new Error('Please select a customer.');
      const amount = parseFloat(rpAmount);
      if (!amount || amount <= 0) throw new Error('Please enter a valid payment amount.');
      if (['card', 'mobile', 'cheque'].includes(rpPaymentMethod) && !rpReferenceNumber.trim()) {
        throw new Error(`A reference number is required for ${rpPaymentMethod} payments.`);
      }

      const totalOwed = rpOutstanding.reduce((sum, tx) => {
        return sum + ((tx.term_remaining_balance || tx.total_amount) - (tx.term_paid_amount || 0));
      }, 0);
      if (amount > totalOwed) throw new Error(`Payment amount (${formatPrice(amount)}) exceeds outstanding balance (${formatPrice(totalOwed)}).`);

      setSuccessMessage('Processing term payment...');

      const cashierId = typeof window !== 'undefined' ? sessionStorage.getItem('cashier_id') : null;
      if (!cashierId) throw new Error('Cashier information not found.');

      const { data: paymentData, error: paymentError } = await supabase
        .from('term_payments')
        .insert({
          customer_id: rpSelectedCustomer.id,
          cashier_id: cashierId,
          amount: amount,
          payment_method: rpPaymentMethod,
          reference_number: ['card', 'mobile', 'cheque'].includes(rpPaymentMethod) ? rpReferenceNumber : null,
          notes: rpNotes.trim() || null
        })
        .select()
        .single();
      if (paymentError) throw paymentError;

      let remaining = amount;
      const perTxAlloc: Record<string, number> = {};
      for (const tx of rpOutstanding) {
        if (remaining <= 0) break;
        const owed = (Number(tx.term_remaining_balance) || Number(tx.total_amount)) - (Number(tx.term_paid_amount) || 0);
        const alloc = Math.min(remaining, owed);
        perTxAlloc[tx.id] = alloc;

        if (tx.id === 'balance_override') {
          const newOverrideBalance = owed - alloc;
          const { error: overrideError } = await supabase
            .from('customers')
            .update({ balance_override: newOverrideBalance })
            .eq('id', rpSelectedCustomer.id);
          if (overrideError) throw overrideError;
        } else {
          const { error: allocError } = await supabase
            .from('term_payment_allocations')
            .insert({
              term_payment_id: paymentData.id,
              transaction_id: tx.id,
              amount: alloc
            });
          if (allocError) throw allocError;

          const newPaid = (Number(tx.term_paid_amount) || 0) + alloc;
          const { error: updateError } = await supabase
            .rpc('update_transaction_term_paid_amount', {
              p_transaction_id: tx.id,
              p_term_paid_amount: newPaid
            });
          if (updateError) throw updateError;
        }

        remaining -= alloc;
      }

      setTermReceiptData({
        id: paymentData.id,
        customerName: rpSelectedCustomer.name,
        amount: amount,
        paymentMethod: rpPaymentMethod,
        referenceNumber: ['card', 'mobile', 'cheque'].includes(rpPaymentMethod) ? rpReferenceNumber : null,
        notes: rpNotes.trim() || null,
        date: new Date().toISOString(),
        cashierName: user?.cashier_username,
        allocations: Object.entries(perTxAlloc).map(([txId, allocAmount]) => {
          const tx = rpOutstanding.find(t => t.id === txId);
          return {
            transactionId: txId,
            amount: allocAmount,
            total: tx?.total_amount || 0
          };
        }),
        remainingBalance: rpOutstanding.reduce((sum, tx) => {
          const newPaid = (Number(tx.term_paid_amount) || 0) + (perTxAlloc[tx.id] || 0);
          const total = Number(tx.term_remaining_balance) || Number(tx.total_amount);
          return sum + Math.max(0, total - newPaid);
        }, 0)
      });
      setIsReceivePaymentOpen(false);
      setIsTermReceiptOpen(true);
      setRpCustomerName('');
      setRpSelectedCustomer(null);
      setRpAmount('');
      setRpOutstanding([]);
      setRpTxItems({});
      setRpPreview([]);
      setRpReferenceNumber('');
      setRpNotes('');
      setRpCustomerBalanceOverride(0);
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (error: any) {
      console.error('Term payment error:', error);
      setError(error.message || 'Term payment failed.');
    }
  };

  const fetchCustomerList = async () => {
    setCustomerListLoading(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('name');
      if (error) throw error;
      const result: any[] = [];
      for (const c of data || []) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('term_remaining_balance, term_paid_amount')
          .eq('customer_id', c.id)
          .eq('payment_method', 'term')
          .eq('status', 'completed')
          .is('voided_at', null);
        const termBalance = (txs || []).reduce((sum, tx) => {
          return sum + ((tx.term_remaining_balance || 0) - (tx.term_paid_amount || 0));
        }, 0);
        const totalBalance = Math.max(0, termBalance) + (c.balance_override || 0);
        result.push({ ...c, term_balance: Math.max(0, termBalance), total_balance: totalBalance });
      }
      result.sort((a, b) => b.total_balance - a.total_balance);
      setCustomerListData(result);
    } catch (err) {
      console.error('Error fetching customer list:', err);
    } finally {
      setCustomerListLoading(false);
    }
  };

  const saveCustomer = async () => {
    if (!cfName.trim()) {
      setError('Customer name is required.');
      return;
    }
    setCfSaving(true);
    try {
      const payload = {
        name: cfName.trim(),
        address: cfAddress.trim() || null,
        tin_number: cfTinNumber.trim() || null,
        balance_override: parseFloat(cfBalanceOverride) || 0,
      };
      if (editingCustomer) {
        const { error } = await supabase
          .from('customers')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingCustomer.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('customers')
          .insert(payload);
        if (error) throw error;
      }
      setIsCustomerFormOpen(false);
      setEditingCustomer(null);
      setCfName('');
      setCfAddress('');
      setCfTinNumber('');
      setCfBalanceOverride('0');
      fetchCustomerList();
    } catch (err: any) {
      console.error('Error saving customer:', err);
      setError(err.message || 'Failed to save customer.');
    } finally {
      setCfSaving(false);
    }
  };

  const deleteCustomer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchCustomerList();
    } catch (err: any) {
      console.error('Error deleting customer:', err);
      setError(err.message || 'Failed to delete customer.');
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.barcode && product.barcode.includes(searchTerm));
      const matchesCategory = !selectedCategory || product.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative h-20 w-20 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20"></div>
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
            <ShoppingCart className="absolute inset-0 m-auto h-8 w-8 text-primary animate-pulse" />
          </div>
          <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Initializing Terminal...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-screen bg-background flex flex-col overflow-hidden print:hidden">
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-sm px-4">
          {error && (
            <div className="bg-red-600 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center justify-between animate-in slide-in-from-top duration-300">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5" />
                <p className="text-sm font-bold">{error}</p>
              </div>
              <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
          {successMessage && (
            <div className="bg-primary text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top duration-300">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-bold">{successMessage}</p>
            </div>
          )}
        </div>

        <header className="bg-card border-b border-border h-16 flex items-center justify-between px-6 shrink-0 relative z-10">
          <div className="flex items-center gap-4">
            <img src="/logo.jpg" alt="Logo" className="h-10 w-10 rounded-xl object-cover shadow-lg shadow-primary/20" />
            <div>
              <h1 className="text-lg font-black tracking-tight dark:text-white uppercase leading-none">SmartPOS <span className="text-primary text-[10px] bg-primary/10 px-1.5 py-0.5 rounded-md ml-1">Terminal</span></h1>
              <p className="text-[10px] text-muted-foreground font-bold mt-1 uppercase flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Operator: {user?.cashier_username || 'Staff'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="h-8 w-px bg-border mx-2" />
            <Button onClick={() => setIsDailyReportOpen(true)} variant="outline" size="sm" className="font-bold text-xs flex items-center gap-2 border-dashed border-primary/50 text-primary hover:bg-primary/10"><FileText className="h-4 w-4 hidden md:block" /> DAILY REPORT</Button>
            <Button onClick={() => {setIsReceivePaymentOpen(true); setRpCustomerName(''); setRpSelectedCustomer(null); setRpAmount(''); setRpOutstanding([]); setRpTxItems({}); setRpPreview([]); setRpNotes('');}} variant="outline" size="sm" className="font-bold text-xs flex items-center gap-2 border-dashed border-orange-500/50 text-orange-600 hover:bg-orange-50"><HandCoins className="h-4 w-4 hidden md:block" /> RECEIVE</Button>
            <Button onClick={() => { setIsCustomerListOpen(true); fetchCustomerList(); }} variant="outline" size="sm" className="font-bold text-xs flex items-center gap-2 border-dashed border-blue-500/50 text-blue-600 hover:bg-blue-50"><Users className="h-4 w-4 hidden md:block" /> CUSTOMERS</Button>
            <Button onClick={() => setIsManualEntryOpen(true)} variant="outline" size="sm" className="font-bold text-xs flex items-center gap-2 border-dashed border-amber-500/50 text-amber-600 hover:bg-amber-50"><FileText className="h-4 w-4 hidden md:block" /> MANUAL{pendingManualCount > 0 ? ` (${pendingManualCount})` : ''}</Button>
            <Button onClick={handleSignOut} variant="destructive" size="sm" className="font-bold text-xs flex items-center gap-2"><LogOut className="h-4 w-4" /> LOGOUT</Button>
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden">
          <section className="flex-1 flex flex-col bg-background">
            <div className="p-4 border-b border-border bg-card/50 backdrop-blur-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search item..." 
                    className="pl-10 h-11 bg-white dark:bg-gray-800 rounded-xl" 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleBarcodeSubmit((e.target as HTMLInputElement).value, 'search');
                      }
                    }}
                  />
                </div>
                <div className="relative group">
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    ref={barcodeInputRef} 
                    placeholder="Scan barcode..." 
                    className="pl-10 h-11 bg-white dark:bg-gray-800 rounded-xl"
                    value={barcodeValue}
                    onChange={(e) => setBarcodeValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleBarcodeSubmit((e.target as HTMLInputElement).value, 'barcode');
                      }
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                <Button variant={selectedCategory === null ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory(null)} className="rounded-full text-[10px] uppercase h-8">All Items</Button>
                {PRODUCT_CATEGORIES.map((category) => (
                  <Button key={category} variant={selectedCategory === category ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory(category)} className="rounded-full text-[10px] uppercase h-8">{category}</Button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredProducts.map((product) => (
                  <div key={product.id} className="group relative" onClick={() => addToCart(product)}>
                    <Card className={`h-full flex flex-col cursor-pointer transition-all border-border overflow-hidden ${product.stock_quantity <= 0 ? 'opacity-60 grayscale' : ''}`}>
                      <div className="aspect-square bg-gray-100 dark:bg-gray-800 flex items-center justify-center relative overflow-hidden">
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.name} className="h-full w-full object-cover transition-transform group-hover:scale-110 duration-500" />
                        ) : (
                          <Box className="h-12 w-12 text-gray-300 dark:text-gray-700" />
                        )}
                        <div className="absolute top-2 right-2"><Badge variant="secondary">{formatPrice(product.price)}</Badge></div>
                      </div>
                      <CardContent className="p-3 flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="text-sm font-bold dark:text-white line-clamp-2">{product.name}</h3>
                          <p className="text-[10px] text-muted-foreground font-mono">{product.barcode || 'NO BARCODE'}</p>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className={`text-[9px] font-black uppercase ${product.stock_quantity > 10 ? 'text-green-500' : 'text-orange-500'}`}>Stock: {product.stock_quantity}</span>
                          <div className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Plus className="h-3 w-3" /></div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="w-[400px] bg-card border-l border-border flex flex-col shadow-2xl relative z-10">
            <div className="p-6 border-b border-border shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black uppercase dark:text-white flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" /> Checkout</h2>
                <Badge variant="outline">{cart.length} Items</Badge>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-20">
                  <ShoppingCart className="h-16 w-16 mb-4" />
                  <p className="text-sm font-bold uppercase tracking-widest">Cart is Empty</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-2xl border border-transparent hover:border-primary/20 transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h4 className="text-sm font-bold dark:text-white leading-tight">{item.name}</h4>
                        <p className="text-xs text-primary font-bold">{formatPrice(item.price)}</p>
                      </div>
                      <button onClick={() => removeFromCart(item.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="flex items-center justify-between bg-background rounded-xl p-1 shadow-sm">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateQuantity(item.id, item.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                        <Input
                          type="number"
                          className="w-10 h-8 text-center text-xs font-black bg-transparent border-none p-0 focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={item.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val)) {
                              updateQuantity(item.id, val);
                            } else if (e.target.value === '') {
                              // If cleared, we can either set to 0 (removes item) or leave as is. 
                              // Setting to 0 is the most intuitive "delete" action via input.
                              updateQuantity(item.id, 0);
                            }
                          }}
                          onFocus={(e) => e.target.select()}
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => updateQuantity(item.id, item.quantity + 1)} disabled={item.quantity >= item.stock_quantity}><Plus className="h-3 w-3" /></Button>
                      </div>
                      <span className="text-sm font-black pr-2">{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-6 bg-muted/30 border-t border-border shrink-0 space-y-4">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-2xl font-black dark:text-white">
                  <span className="text-sm uppercase">Total</span>
                  <span className="text-primary">{formatPrice(calculateTotal())}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="h-14 rounded-2xl font-bold uppercase text-xs" onClick={() => setCart([])} disabled={cart.length === 0}>Clear</Button>
                <Button className="h-14 rounded-2xl font-black uppercase text-xs shadow-xl" onClick={handleProcessPayment} disabled={cart.length === 0}>Pay Now</Button>
              </div>
            </div>
          </aside>
        </main>

        <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="Processing Order" size="md">
          <div className="space-y-8 p-2">
            <div className="text-center">
              <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest mb-1">Total Due</p>
              {applyDiscount && discountAmount > 0 ? (
                <>
                  <p className="text-lg font-bold text-muted-foreground line-through">{formatPrice(calculateTotal())}</p>
                  <h2 className="text-5xl font-black text-green-600">{formatPrice(parseFloat((calculateTotal() - discountAmount).toFixed(2)))}</h2>
                  <p className="text-xs font-bold text-green-600 mt-1">-{formatPrice(discountAmount)} Discount</p>
                </>
              ) : (
                <h2 className="text-5xl font-black text-primary">{formatPrice(calculateTotal())}</h2>
              )}
            </div>
            <div className="grid grid-cols-5 gap-4">
              <PaymentTab active={paymentMethod === 'cash'} onClick={() => setPaymentMethod('cash')} icon={<Wallet className="h-5 w-5" />} label="Cash" />
              <PaymentTab active={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')} icon={<CreditCard className="h-5 w-5" />} label="Card" />
              <PaymentTab active={paymentMethod === 'mobile'} onClick={() => setPaymentMethod('mobile')} icon={<Monitor className="h-5 w-5" />} label="Mobile" />
              <PaymentTab active={paymentMethod === 'cheque'} onClick={() => setPaymentMethod('cheque')} icon={<Landmark className="h-5 w-5" />} label="Cheque" />
              <PaymentTab active={paymentMethod === 'term'} onClick={() => setPaymentMethod('term')} icon={<CalendarDays className="h-5 w-5" />} label="Term" />
            </div>
            {paymentMethod === 'cash' && (
              <div className="bg-muted/50 p-6 rounded-3xl border border-border">
                <label className="block text-xs font-black uppercase text-gray-600 dark:text-gray-400 mb-3 text-center">Amount Tendered</label>
                <div className="relative">
                  <Input type="number" className="h-20 text-center text-4xl font-black bg-card rounded-2xl" placeholder="0.00" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} autoFocus />
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-black text-gray-300">₱</div>
                </div>
                {parseFloat(amountReceived) >= (applyDiscount && discountAmount > 0 ? parseFloat((calculateTotal() - discountAmount).toFixed(2)) : calculateTotal()) && (
                  <div className="mt-6 text-center animate-in zoom-in duration-300">
                    <p className="text-xs font-black text-green-600 uppercase mb-1">Change Due</p>
                    <h3 className="text-4xl font-black text-green-700">{formatPrice(calculateChange())}</h3>
                  </div>
                )}
              </div>
            )}
            
            {['card', 'mobile', 'cheque'].includes(paymentMethod) && (
              <div className="bg-muted/50 p-6 rounded-3xl border border-border">
                <label className="block text-xs font-black uppercase text-gray-600 dark:text-gray-400 mb-3 text-center">Reference / Trace Number</label>
                <div className="relative">
                  <Input 
                    type="text" 
                    className="h-20 text-center text-4xl font-black bg-card rounded-2xl" 
                    placeholder={`Enter ${paymentMethod} reference...`} 
                    value={referenceNumber} 
                    onChange={(e) => setReferenceNumber(e.target.value)} 
                    autoFocus 
                  />
                </div>
              </div>
            )}

            {paymentMethod === 'term' && (
              <div className="bg-muted/50 p-6 rounded-3xl border border-border space-y-4">
                <div>
                  <label className="block text-xs font-black uppercase text-gray-600 dark:text-gray-400 mb-3 text-center">Terms Duration</label>
                  <div className="relative">
                    <Input
                      type="number"
                      className="h-20 text-center text-4xl font-black bg-card rounded-2xl"
                      placeholder="30"
                      min={1}
                      value={termDays || ''}
                      onChange={(e) => setTermDays(Math.max(1, parseInt(e.target.value) || 1))}
                      autoFocus
                    />
                    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-2xl font-black text-muted-foreground">Days</span>
                  </div>
                </div>
                <div className="bg-background rounded-xl p-3 space-y-1">
                  {(() => {
                    const rawTotal = calculateTotal();
                    const discAmount = applyDiscount && discountAmount > 0 ? discountAmount : 0;
                    const discTotal = parseFloat((rawTotal - discAmount).toFixed(2));
                    const due = new Date(Date.now() + termDays * 24 * 60 * 60 * 1000);
                    return (
                      <>
                        {applyDiscount && discountAmount > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="font-bold line-through">{formatPrice(rawTotal)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Total Due</span>
                          <span className="font-bold">{formatPrice(discTotal)}</span>
                        </div>
                        <div className="border-t border-border pt-1 flex justify-between text-sm">
                          <span className="font-black">Due Date</span>
                          <span className="font-black text-orange-600">{due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
            
            <div className="bg-muted/50 p-4 rounded-3xl border border-border">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-black uppercase text-gray-600 dark:text-gray-400">Discount</label>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={applyDiscount}
                    onChange={() => {
                      setApplyDiscount(!applyDiscount);
                      if (applyDiscount) setDiscountAmount(0);
                    }}
                  />
                  <div className="peer h-6 w-11 rounded-full border bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-5 peer-checked:after:border-white dark:border-gray-600 dark:bg-gray-700 dark:after:bg-gray-400"></div>
                </label>
              </div>
              {applyDiscount && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">Discount Amount</label>
                    <div className="relative">
                      <Input
                        type="number"
                        className="h-10 text-center text-lg font-black bg-card rounded-xl pl-8"
                        placeholder="0.00"
                        min={0}
                        max={calculateTotal()}
                        step="0.01"
                        value={discountAmount || ''}
                        onChange={(e) => setDiscountAmount(Math.min(calculateTotal(), Math.max(0, parseFloat(e.target.value) || 0)))}
                      />
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₱</span>
                    </div>
                  </div>
                  <div className="bg-background rounded-xl p-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Original</span>
                      <span className="font-bold">{formatPrice(calculateTotal())}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="font-bold text-red-500">-{formatPrice(discountAmount)}</span>
                    </div>
                    <div className="border-t border-border pt-1 flex justify-between text-sm">
                      <span className="font-black">Final</span>
                      <span className="font-black text-green-600">{formatPrice(parseFloat((calculateTotal() - discountAmount).toFixed(2)))}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-muted/50 p-4 rounded-3xl border border-border">
              <label className="block text-xs font-black uppercase text-gray-600 dark:text-gray-400 mb-2 text-center">Customer Name (optional)</label>
              <Input
                type="text"
                className="h-12 text-center text-base font-bold bg-card rounded-2xl"
                placeholder="e.g. Humphrey Bogart"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>

            {paymentMethod === 'term' && (
              <div className="bg-muted/50 p-4 rounded-3xl border border-border">
                <label className="block text-xs font-black uppercase text-gray-600 dark:text-gray-400 mb-2 text-center">Link to Existing Customer</label>
                <div className="relative">
                  <Input
                    type="text"
                    className="h-12 text-center text-base font-bold bg-card rounded-2xl"
                    placeholder="Search customer..."
                    value={termCustSearch}
                    onChange={(e) => {
                      setTermCustSearch(e.target.value);
                      searchTermCustomer(e.target.value);
                      setTermCustSelected(null);
                      setTermCustOutstanding(0);
                    }}
                  />
                  {termCustResults.length > 0 && !termCustSelected && (
                    <div className="absolute top-full left-0 right-0 bg-popover border border-border rounded-xl shadow-xl z-50 mt-1 max-h-48 overflow-y-auto">
                      {termCustResults.map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-4 py-3 text-sm font-bold hover:bg-muted transition-colors border-b border-border last:border-0"
                          onClick={() => selectTermCustomer(c)}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {termCustSelected && (
                  <div className="mt-3 bg-card rounded-xl p-3 border border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-green-600">✓ {termCustSelected.name}</span>
                      <button className="text-[10px] text-muted-foreground underline" onClick={() => { setTermCustSelected(null); setTermCustSearch(''); setTermCustOutstanding(0); }}>Clear</button>
                    </div>
                    {termCustOutstanding > 0 && (
                      <p className="text-xs text-red-500 font-bold mt-1">Outstanding: ₱{termCustOutstanding.toFixed(2)}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-4">
              <Button variant="ghost" className="flex-1 h-14 rounded-2xl font-bold uppercase" onClick={() => setIsPaymentModalOpen(false)}>Back</Button>
              <Button className="flex-[2] h-14 rounded-2xl font-black uppercase" onClick={completeTransaction}>Finalize</Button>
            </div>
          </div>
        </Modal>

        <Modal isOpen={isReceiptModalOpen} onClose={() => { setIsReceiptModalOpen(false); setPrintMode(null); }} title="Finalized" size="md">
        {receiptData && printMode === 'sale' && (
            <div className="bg-white p-8 rounded-3xl text-gray-900 shadow-inner">
              <div className="text-center mb-8">
                <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary"><Receipt className="h-6 w-6" /></div>
                <h2 className="text-2xl font-black uppercase">{settings?.store_name || 'SMART POS'}</h2>
                {settings?.show_address_on_receipt && settings?.store_address && (
                  <p className="text-gray-500 text-sm mt-1">{settings.store_address}</p>
                )}
                {settings?.show_phone_on_receipt && settings?.store_phone && (
                  <p className="text-gray-500 text-sm">TEL: {settings.store_phone}</p>
                )}
                {settings?.receipt_header && receiptData?.paymentMethod !== 'term' && (
                  <p className="text-gray-500 text-xs mt-2 italic whitespace-pre-wrap">{settings.receipt_header}</p>
                )}
                {receiptData?.paymentMethod === 'term' && (
                  <p className="text-gray-500 text-xs mt-2 italic font-bold uppercase">TERM PAYMENT RECEIPT</p>
                )}
              </div>
              <div className={`grid ${receiptData.paymentMethod === 'term' ? 'grid-cols-3' : receiptData.referenceNumber ? 'grid-cols-3' : 'grid-cols-2'} gap-4 border-y border-dashed border-gray-200 py-6 mb-8 text-xs`}>
                <div><p className="font-black text-gray-400 uppercase">Order Ref</p><p className="font-mono font-bold">{receiptData.id.substring(0, 8).toUpperCase()}</p></div>
                {receiptData.paymentMethod === 'term' ? (
                  <div className="text-center"><p className="font-black text-gray-400 uppercase">Full Amount</p><p className="font-mono font-bold">{formatPrice(receiptData.total)}</p></div>
                ) : receiptData.referenceNumber ? (
                  <div className="text-center"><p className="font-black text-gray-400 uppercase">Payment Ref</p><p className="font-mono font-bold uppercase">{receiptData.referenceNumber}</p></div>
                ) : null}
                <div className="text-right"><p className="font-black text-gray-400 uppercase">Method</p><Badge className="text-[8px] font-black uppercase h-4 px-1.5">{receiptData.paymentMethod}</Badge></div>
              </div>

              {receiptData.paymentMethod === 'term' && (
                <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 mb-8 flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-black text-orange-700 uppercase">Amount Due</p>
                    <p className="text-xl font-black text-orange-700">{formatPrice(receiptData.remainingBalance || receiptData.total)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-orange-700 uppercase">Due Date</p>
                    <p className="text-base font-black text-orange-700">{new Date(receiptData.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                </div>
              )}

              {/* Editable Fields for Receipt */}
              <div className="grid grid-cols-3 gap-2 mb-8">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Delivered To</label>
                  <Input
                    placeholder="Buyer..."
                    value={deliveredTo}
                    onChange={(e) => setDeliveredTo(e.target.value)}
                    className="h-8 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">TIN</label>
                  <Input
                    placeholder="TIN..."
                    value={tin}
                    onChange={(e) => setTin(e.target.value)}
                    className="h-8 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1">Purchase Order</label>
                  <Input
                    placeholder="Serial #"
                    value={orNumber}
                    onChange={(e) => setOrNumber(e.target.value)}
                    className="h-8 text-xs font-bold border-red-200 focus:border-red-500 text-red-600"
                  />
                </div>
              </div>

              {/* Signature Toggle - Modern Minimal */}
              <div className="bg-card p-5 rounded-2xl mb-8 border border-border shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl transition-all ${showSignatures ? 'bg-primary/10 text-primary' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">Include Signatures</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Cashier & Customer signature lines</p>
                    </div>
                  </div>

                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={showSignatures}
                      onChange={() => setShowSignatures(!showSignatures)}
                    />
                    <div className="peer h-7 w-12 rounded-full border bg-gray-200 after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-5 peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-primary/50 peer-focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:after:bg-gray-400"></div>
                  </label>
                </div>
              </div>

              <div className="mb-8">
                <table className="w-full border-collapse border border-gray-200 text-xs">
                  <thead>
                    <tr className="bg-gray-50 uppercase text-[9px] font-black text-gray-400">
                      <th className="border border-gray-200 px-2 py-1 text-center">Qty</th>
                      <th className="border border-gray-200 px-2 py-1 text-left">Description</th>
                      <th className="border border-gray-200 px-2 py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiptData.items.map((item: any, idx: number) => (
                      <tr key={idx}>
                        <td className="border border-gray-200 px-2 py-1 text-center font-bold">{item.quantity}</td>
                        <td className="border border-gray-200 px-2 py-1">
                          <p className="font-bold text-gray-800 uppercase text-[10px]">{item.name}</p>
                          <p className="text-[9px] text-gray-400 font-bold">@{formatPrice(item.price)}</p>
                        </td>
                        <td className="border border-gray-200 px-2 py-1 text-right font-black">{formatPrice(item.price * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-gray-50 p-6 rounded-2xl mb-8 space-y-3">
                <div className="flex justify-between items-center text-gray-600">
                  <span className="text-xs font-bold uppercase">VATable Sales</span>
                  <span className="font-bold">{formatPrice(receiptData.total / (1 + (settings?.tax_rate || 12) / 100))}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span className="text-xs font-bold uppercase">Less VAT</span>
                  <span className="font-bold">{formatPrice(receiptData.total - (receiptData.total / (1 + (settings?.tax_rate || 12) / 100)))}</span>
                </div>
                <div className="border-t border-dashed border-gray-300 pt-3 flex justify-between items-center text-xl font-black text-gray-900">
                  <span className="text-sm uppercase">Total Sales (VAT Inclusive)</span>
                  <span className="text-2xl">{formatPrice(receiptData.total)}</span>
                </div>
              </div>
              <div className="text-center text-xs text-gray-500 mb-6 whitespace-pre-wrap">
                {settings?.receipt_footer || (
                  <>
                    <p>Thank you for your purchase!</p>
                    <p>Please come again.</p>
                  </>
                )}
              </div>
              <div className="flex gap-4">
                <Button variant="ghost" className="flex-1 h-12 rounded-2xl font-bold uppercase" onClick={cancelTransaction}>Close</Button>
                <Button className="flex-[2] h-12 rounded-2xl font-black uppercase" onClick={printReceipt}>Print Ticket</Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal isOpen={isReceivePaymentOpen} onClose={() => setIsReceivePaymentOpen(false)}>
          <div className="p-6 max-w-lg mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <HandCoins className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <h2 className="text-lg font-black">Receive Term Payment</h2>
                <p className="text-xs text-muted-foreground font-bold">Record an incoming payment for outstanding term transactions</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Customer</label>
                <div className="relative">
                  <Input
                    placeholder="Search customer name..."
                    value={rpCustomerName}
                    onChange={(e) => {
                      setRpCustomerName(e.target.value);
                      searchRpCustomers(e.target.value);
                      setRpSelectedCustomer(null);
                      setRpOutstanding([]);
      setRpTxItems({});
                      setRpPreview([]);
                    }}
                    className="h-10 font-bold"
                  />
                  {rpCustomers.length > 0 && !rpSelectedCustomer && (
                    <div className="absolute top-full left-0 right-0 bg-popover border border-border rounded-xl shadow-xl z-50 mt-1 max-h-48 overflow-y-auto">
                      {rpCustomers.map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-4 py-3 text-sm font-bold hover:bg-muted transition-colors border-b border-border last:border-0"
                          onClick={() => selectRpCustomer(c)}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {rpOutstanding.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Outstanding</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                    {rpOutstanding.map((tx) => {
                      const owed = (tx.term_remaining_balance || tx.total_amount) - (tx.term_paid_amount || 0);
                      const isOverride = tx.id === 'balance_override';
                      const productNames = rpTxItems[tx.id] || [];
                      return (
                        <div key={tx.id} className={`rounded-xl p-3 border ${isOverride ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' : 'bg-card border-border'}`}>
                          <div className="flex justify-between items-start">
                            <div>
                              {isOverride ? (
                                <p className="text-xs font-bold text-blue-600">Manual Balance</p>
                              ) : (
                                <p className="text-xs font-mono font-bold text-muted-foreground">#{tx.id.slice(0, 8).toUpperCase()}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground">{isOverride ? 'Set in Customers modal' : new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                            </div>
                            <span className="text-sm font-black text-red-500">₱{owed.toFixed(2)} remaining</span>
                          </div>
                          {!isOverride && productNames.length > 0 && (
                            <p className="text-[10px] text-muted-foreground font-bold mt-1 truncate">{productNames.join(', ')}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {rpOutstanding.length > 0 && (
                <div className="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-2xl p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-orange-700 uppercase">Outstanding Balance</span>
                    <span className="text-xl font-black text-orange-700">
                      {formatPrice(rpOutstanding.reduce((sum, tx) => sum + ((tx.term_remaining_balance || tx.total_amount) - (tx.term_paid_amount || 0)), 0))}
                    </span>
                  </div>
                  <p className="text-[10px] text-orange-600 font-bold">{rpOutstanding.length} transaction{rpOutstanding.length !== 1 ? 's' : ''} awaiting payment</p>
                </div>
              )}

              {rpOutstanding.length === 0 && rpSelectedCustomer && (
                <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-2xl p-4">
                  <p className="text-sm font-bold text-green-700 text-center">No outstanding term transactions.</p>
                </div>
              )}

              {rpOutstanding.length > 0 && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Payment Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-muted-foreground">₱</span>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={rpAmount}
                        onChange={(e) => { setRpAmount(e.target.value); recalcRpPreview(e.target.value); }}
                        className="h-12 pl-8 text-lg font-black"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Payment Method</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['cash', 'card', 'mobile', 'cheque'] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setRpPaymentMethod(m)}
                          className={`py-2 rounded-xl border-2 text-xs font-black uppercase transition-all ${
                            rpPaymentMethod === m
                              ? 'bg-orange-500 border-orange-500 text-white shadow-lg'
                              : 'bg-card border-border text-muted-foreground hover:border-orange-500/50'
                          }`}
                        >
                          {m === 'cash' ? '💵' : m === 'card' ? '💳' : m === 'mobile' ? '📱' : '📄'} {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {['card', 'mobile', 'cheque'].includes(rpPaymentMethod) && (
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Reference Number</label>
                      <Input
                        placeholder="Reference #"
                        value={rpReferenceNumber}
                        onChange={(e) => setRpReferenceNumber(e.target.value)}
                        className="h-10 font-bold"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Notes <span className="text-muted-foreground/50">(optional)</span></label>
                    <Input
                      placeholder="Payment notes..."
                      value={rpNotes}
                      onChange={(e) => setRpNotes(e.target.value)}
                      className="h-10 font-bold"
                    />
                  </div>

                  {rpPreview.length > 0 && (
                    <div>
                      <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Allocation Preview <span className="text-muted-foreground/50">(FIFO)</span></label>
                      <div className="bg-muted/50 rounded-2xl p-3 space-y-2">
                        {rpPreview.map((p, i) => (
                          <div key={i} className="flex justify-between items-center py-1.5 border-b border-border last:border-0">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <div>
                                <p className="text-xs font-bold text-foreground">
                                  #{p.tx.id.slice(0, 8)} <span className="text-muted-foreground">—</span> {new Date(p.tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-bold">
                                  Owed: {formatPrice((p.tx.term_remaining_balance || p.tx.total_amount) - (p.tx.term_paid_amount || 0))}
                                </p>
                              </div>
                            </div>
                            <span className="text-sm font-black text-green-600">{formatPrice(p.allocated)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center pt-2 border-t-2 border-dashed border-border">
                          <span className="text-xs font-bold uppercase text-muted-foreground">Total Applied</span>
                          <span className="text-base font-black">{formatPrice(rpPreview.reduce((sum, p) => sum + p.allocated, 0))}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-4 mt-8">
              <Button variant="ghost" className="flex-1 h-12 rounded-2xl font-bold uppercase" onClick={() => setIsReceivePaymentOpen(false)}>Cancel</Button>
              <Button
                className="flex-[2] h-12 rounded-2xl font-black uppercase bg-orange-500 hover:bg-orange-600"
                onClick={completeTermPayment}
                disabled={!rpSelectedCustomer || rpOutstanding.length === 0 || !rpAmount || parseFloat(rpAmount) <= 0}
              >
                <HandCoins className="h-5 w-5 mr-2" /> Confirm Payment
              </Button>
            </div>
          </div>
        </Modal>

        <Modal isOpen={isTermReceiptOpen} onClose={() => setIsTermReceiptOpen(false)} title="Term Payment" size="md">
          {termReceiptData && (
            <div className="bg-white p-8 rounded-3xl text-gray-900 shadow-inner">
              <div className="text-center mb-8">
                <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 text-primary"><Receipt className="h-6 w-6" /></div>
                <h2 className="text-2xl font-black uppercase">{settings?.store_name || 'SMART POS'}</h2>
                {settings?.show_address_on_receipt && settings?.store_address && (
                  <p className="text-gray-500 text-sm mt-1">{settings.store_address}</p>
                )}
                {settings?.show_phone_on_receipt && settings?.store_phone && (
                  <p className="text-gray-500 text-sm">TEL: {settings.store_phone}</p>
                )}
                <p className="text-gray-500 text-xs mt-2 italic font-bold uppercase">TERM PAYMENT RECEIPT</p>
              </div>

              <div className="grid grid-cols-3 gap-4 border-y border-dashed border-gray-200 py-6 mb-8 text-xs">
                <div><p className="font-black text-gray-400 uppercase">Payment Ref</p><p className="font-mono font-bold">{termReceiptData.id.substring(0, 8).toUpperCase()}</p></div>
                <div className="text-center"><p className="font-black text-gray-400 uppercase">Amount Paid</p><p className="font-mono font-bold">{formatPrice(termReceiptData.amount)}</p></div>
                <div className="text-right"><p className="font-black text-gray-400 uppercase">Method</p><Badge className="text-[8px] font-black uppercase h-4 px-1.5">{termReceiptData.paymentMethod}</Badge></div>
              </div>

              <div className="bg-gray-50 p-6 rounded-2xl mb-8 space-y-2">
                <div className="flex justify-between items-center text-gray-600">
                  <span className="text-xs font-bold uppercase">Customer</span>
                  <span className="font-bold text-gray-900">{termReceiptData.customerName}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span className="text-xs font-bold uppercase">Cashier</span>
                  <span className="font-bold text-gray-900">{termReceiptData.cashierName || 'Staff'}</span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span className="text-xs font-bold uppercase">Date</span>
                  <span className="font-bold text-gray-900">{new Date(termReceiptData.date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {termReceiptData.referenceNumber && (
                  <div className="flex justify-between items-center text-gray-600">
                    <span className="text-xs font-bold uppercase">Reference</span>
                    <span className="font-bold text-gray-900">{termReceiptData.referenceNumber}</span>
                  </div>
                )}
                {termReceiptData.notes && (
                  <div className="flex justify-between items-center text-gray-600">
                    <span className="text-xs font-bold uppercase">Notes</span>
                    <span className="font-bold text-gray-900 italic">{termReceiptData.notes}</span>
                  </div>
                )}
              </div>

              <div className="mb-8">
                <table className="w-full border-collapse border border-gray-200 text-xs">
                  <thead>
                    <tr className="bg-gray-50 uppercase text-[9px] font-black text-gray-400">
                      <th className="border border-gray-200 px-2 py-1 text-left">Transaction</th>
                      <th className="border border-gray-200 px-2 py-1 text-right">Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {termReceiptData.allocations.map((a: any, i: number) => (
                      <tr key={i}>
                        <td className="border border-gray-200 px-2 py-1 font-mono font-bold text-gray-800 text-[10px]">
                          {a.transactionId === 'balance_override' ? 'Manual Balance' : `#${a.transactionId.substring(0, 8)}`}
                        </td>
                        <td className="border border-gray-200 px-2 py-1 text-right font-black text-green-600">{formatPrice(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[9px] text-gray-400 font-bold mt-1">FIFO allocation — manual balance paid first, then oldest transactions</p>
              </div>

              <div className="bg-gray-50 p-6 rounded-2xl mb-8 space-y-3">
                <div className="flex justify-between items-center text-gray-600">
                  <span className="text-xs font-bold uppercase">Total Paid</span>
                  <span className="font-bold text-green-600">{formatPrice(termReceiptData.amount)}</span>
                </div>
                <div className="border-t border-dashed border-gray-300 pt-3 flex justify-between items-center text-xl font-black text-gray-900">
                  <span className="text-sm uppercase">Remaining Balance</span>
                  <span>{formatPrice(termReceiptData.remainingBalance)}</span>
                </div>
              </div>

              <div className="text-center text-xs text-gray-500 mb-6 whitespace-pre-wrap">
                {settings?.receipt_footer || 'Thank you for your payment!'}
              </div>

              <div className="flex gap-4">
                <Button variant="ghost" className="flex-1 h-12 rounded-2xl font-bold uppercase" onClick={cancelTermPayment}>Close</Button>
                <Button className="flex-[2] h-12 rounded-2xl font-black uppercase" onClick={printTermReceipt}><Printer className="h-4 w-4 mr-2" /> Print Ticket</Button>
              </div>
            </div>
          )}
        </Modal>

        <style jsx={true} global={true}>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      </div>
      <div className="hidden print:block">
        {receiptData && printMode === 'sale' && (
          <PrintableReceipt
            transactionId={receiptData.id}
            date={receiptData.date}
            items={receiptData.items}
            subtotal={receiptData.total}
            tax={0}
            total={receiptData.total}
            paymentMethod={receiptData.paymentMethod}
            amountReceived={receiptData.amountReceived}
            change={receiptData.change}
            downPayment={receiptData.downPayment}
            remainingBalance={receiptData.remainingBalance}
            dueDate={receiptData.dueDate}
            storeName={settings?.store_name}
            storeAddress={settings?.store_address}
            storePhone={settings?.store_phone}
            cashierName={user?.cashier_username}
            deliveredTo={deliveredTo}
            tin={tin}
            orNumber={orNumber}
            receiptHeader={settings?.receipt_header}
            receiptFooter={settings?.receipt_footer}
            originalTotal={receiptData.originalTotal}
            discountPercent={receiptData.discountPercent}
            discountAmount={receiptData.discountAmount}
            taxRate={settings?.tax_rate}
            showSignatures={showSignatures}
          />
        )}
      </div>

      <div className="hidden print:block">
        {termReceiptData && printMode === 'term' && (
          <PrintableReceipt
            termPaymentMode
            transactionId={termReceiptData.id}
            date={termReceiptData.date}
            total={termReceiptData.amount}
            paymentMethod={termReceiptData.paymentMethod}
            referenceNumber={termReceiptData.referenceNumber}
            remainingBalance={termReceiptData.remainingBalance}
            storeName={settings?.store_name}
            storeAddress={settings?.store_address}
            storePhone={settings?.store_phone}
            receiptHeader={settings?.receipt_header}
            receiptFooter={settings?.receipt_footer}
            cashierName={termReceiptData.cashierName}
            customerName={termReceiptData.customerName}
            allocations={termReceiptData.allocations}
            notes={termReceiptData.notes}
            showSignatures={showSignatures}
          />
        )}
      </div>

      <Modal isOpen={isCustomerListOpen} onClose={() => { setIsCustomerListOpen(false); setCustomerSearchQuery(''); }} title="Customers" size="lg">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or address..."
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                className="pl-10 h-10 font-bold"
              />
            </div>
            <Button
              onClick={() => { setEditingCustomer(null); setCfName(''); setCfAddress(''); setCfTinNumber(''); setCfBalanceOverride('0'); setIsCustomerFormOpen(true); }}
              className="ml-3 h-10 rounded-2xl font-bold uppercase bg-blue-600 hover:bg-blue-700 text-white"
            >
              <UserPlus className="h-4 w-4 mr-2" /> Add Customer
            </Button>
          </div>

          {customerListLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm font-bold">Loading customers...</p>
            </div>
          ) : customerListData.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-bold">No customers found</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {customerListData
                .filter((c) => {
                  if (!customerSearchQuery.trim()) return true;
                  const q = customerSearchQuery.toLowerCase();
                  return (c.name || '').toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q);
                })
                .map((c) => (
                  <div key={c.id} className="bg-card rounded-xl px-5 py-4 border border-border hover:border-blue-200 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-sm truncate">{c.name}</p>
                          {c.tin_number && (
                            <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">TIN: {c.tin_number}</span>
                          )}
                        </div>
                        {c.address && (
                          <p className="text-xs text-muted-foreground truncate">{c.address}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          <div>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase">Term Balance</p>
                            <p className="text-xs font-black text-orange-600">₱{c.term_balance.toFixed(2)}</p>
                          </div>
                          {(c.balance_override || 0) !== 0 && (
                            <div>
                              <p className="text-[10px] font-bold text-muted-foreground uppercase">Override</p>
                              <p className="text-xs font-black text-blue-600">₱{(c.balance_override || 0).toFixed(2)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase">Total Balance</p>
                            <p className={`text-xs font-black ${c.total_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>₱{c.total_balance.toFixed(2)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-3 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-blue-600"
                          onClick={() => {
                            setEditingCustomer(c);
                            setCfName(c.name || '');
                            setCfAddress(c.address || '');
                            setCfTinNumber(c.tin_number || '');
                            setCfBalanceOverride(String(c.balance_override || 0));
                            setIsCustomerFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                          onClick={() => deleteCustomer(c.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={isCustomerFormOpen} onClose={() => { setIsCustomerFormOpen(false); setEditingCustomer(null); }} title={editingCustomer ? 'Edit Customer' : 'Add Customer'} size="md">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <UserPlus className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-black">{editingCustomer ? 'Edit Customer' : 'New Customer'}</h2>
              <p className="text-xs text-muted-foreground font-bold">{editingCustomer ? 'Update customer details and balance' : 'Fill in the customer details below'}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Customer Name *</label>
              <Input
                placeholder="Enter customer name"
                value={cfName}
                onChange={(e) => setCfName(e.target.value)}
                className="h-10 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Address</label>
              <Input
                placeholder="Enter address (optional)"
                value={cfAddress}
                onChange={(e) => setCfAddress(e.target.value)}
                className="h-10 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">TIN #</label>
              <Input
                placeholder="Enter TIN number (optional)"
                value={cfTinNumber}
                onChange={(e) => setCfTinNumber(e.target.value)}
                className="h-10 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-1.5">Account / Remaining Balance</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-muted-foreground">₱</span>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={cfBalanceOverride}
                  onChange={(e) => setCfBalanceOverride(e.target.value)}
                  className="h-12 pl-8 text-lg font-black"
                  step="0.01"
                />
              </div>
              <p className="text-[10px] text-muted-foreground font-bold mt-1">Manual adjustment. Auto-calculated term balance is added to this value for the total.</p>
            </div>
          </div>

          <div className="flex gap-4 mt-8">
            <Button
              variant="ghost"
              className="flex-1 h-12 rounded-2xl font-bold uppercase"
              onClick={() => { setIsCustomerFormOpen(false); setEditingCustomer(null); }}
            >
              Cancel
            </Button>
            <Button
              className="flex-[2] h-12 rounded-2xl font-black uppercase bg-blue-600 hover:bg-blue-700 text-white"
              onClick={saveCustomer}
              disabled={cfSaving || !cfName.trim()}
            >
              {cfSaving ? 'Saving...' : editingCustomer ? 'Update Customer' : 'Add Customer'}
            </Button>
          </div>
        </div>
      </Modal>

      <DailyReportModal 
        isOpen={isDailyReportOpen} 
        onClose={() => setIsDailyReportOpen(false)} 
        cashierId={user?.cashier_id || null} 
        cashierName={user?.cashier_username || null} 
      />

      <ManualEntryModal
        isOpen={isManualEntryOpen}
        onClose={() => setIsManualEntryOpen(false)}
        cashierId={user?.cashier_id || null}
        cashierUsername={user?.cashier_username || null}
        products={products}
        taxRate={settings?.tax_rate || 12}
        onSubmitted={fetchPendingManualCount}
      />
    </>
  );
}

function PaymentTab({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center h-24 rounded-3xl border-2 transition-all gap-2 ${active ? 'bg-primary border-primary text-primary-foreground shadow-xl' : 'bg-card border-border text-muted-foreground hover:border-primary/50'}`}>
      <span className={active ? 'text-primary-foreground' : 'text-muted-foreground'}>{icon}</span>
      <span className={`text-[10px] font-black uppercase tracking-widest ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</span>
    </button>
  );
}