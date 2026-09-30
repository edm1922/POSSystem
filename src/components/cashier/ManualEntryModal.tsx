'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCurrency } from '@/context/CurrencyContext';
import type { ManualEntryItem, ManualEntryRequest } from '@/types/database';
import {
  Trash2,
  Search,
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Package,
  RotateCcw,
  Pencil,
  X,
} from 'lucide-react';

interface SelectableProduct {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  category?: string;
  barcode?: string;
}

/**
 * A row on screen. `_key` is a local, render-stable identity used as the React
 * list key. Index keys break here: deleting a row shifts every later index, so
 * React reuses the wrong DOM node and the row's clear button and focus end up
 * on the wrong line. It is stripped before submit, so it never reaches the API.
 */
type EditableItem = ManualEntryItem & { _key: string };

let rowKeySeq = 0;
const nextRowKey = () => `row-${++rowKeySeq}`;

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  cashierId: string | null;
  cashierUsername: string | null;
  products: SelectableProduct[];
  taxRate: number;
  onSubmitted: () => void;
}

const todayIso = () => new Date().toISOString().split('T')[0];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'term', label: 'Term' },
] as const;

export function ManualEntryModal({
  isOpen,
  onClose,
  cashierId,
  cashierUsername,
  products,
  taxRate,
  onSubmitted,
}: ManualEntryModalProps) {
  const { formatPrice } = useCurrency();
  const [tab, setTab] = useState<'new' | 'mine'>('new');

  // --- form state ---
  const [manualRef, setManualRef] = useState('');
  const [atpRef, setAtpRef] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [soldBy, setSoldBy] = useState('');
  const [buyerTin, setBuyerTin] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [items, setItems] = useState<EditableItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [termDueDate, setTermDueDate] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [notes, setNotes] = useState('');

  // --- the single line-item composer ---
  // One bar for the whole modal: it searches/scans the catalogue, accepts free
  // text, and edits a loaded line. The draft is deliberately NOT stored on any
  // row - a row's committed description is never bound to live typing, so the
  // input can't blank or corrupt a line while the user is still mid-word.
  const [draft, setDraft] = useState('');
  const [draftOpen, setDraftOpen] = useState(false);
  // -1 means "nothing highlighted", so Enter never picks a product by accident.
  const [draftHighlight, setDraftHighlight] = useState(-1);
  // _key of the row currently loaded for editing, or null when adding.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftFlash, setDraftFlash] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const draftMessage = useRef<number | null>(null);
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingPriceFocus = useRef<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [myRequests, setMyRequests] = useState<ManualEntryRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const needsReference = ['card', 'mobile', 'cheque'].includes(paymentMethod);

  const total = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0),
    [items]
  );

  // VAT-inclusive, matching PrintableReceipt.tsx and the register flow
  const rate = taxRate || 12;
  const vatable = total / (1 + rate / 100);
  const vat = total - vatable;
  const change = Math.max(0, (parseFloat(amountReceived) || 0) - total);

  const resetForm = useCallback(() => {
    setManualRef('');
    setAtpRef('');
    setTransactionDate(todayIso());
    setSoldBy('');
    setBuyerTin('');
    setBuyerAddress('');
    setItems([]);
    setPaymentMethod('cash');
    setReferenceNumber('');
    setTermDueDate('');
    setAmountReceived('');
    setNotes('');
    setDraft('');
    setDraftOpen(false);
    setDraftHighlight(-1);
    setEditingKey(null);
    setDraftFlash(null);
    setEditingId(null);
    setError(null);
    setSuccess(null);
  }, []);

  const loadMyRequests = useCallback(async () => {
    if (!cashierId) return;
    setRequestsLoading(true);
    try {
      // Goes through the RPC rather than a direct table read: cashiers have no
      // Supabase Auth session, so they hold the anon key and are not granted
      // table access on manual_entry_requests.
      const { data, error: err } = await supabase.rpc('list_manual_entry_requests', {
        p_cashier_id: cashierId,
        p_status: null,
      });
      if (err) throw err;
      const rows = (data as ManualEntryRequest[] | null) || [];
      setMyRequests(rows.slice(0, 25));
    } catch (err: any) {
      console.error('Failed to load manual entry requests:', err);
    } finally {
      setRequestsLoading(false);
    }
  }, [cashierId]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
      loadMyRequests();
    }
  }, [isOpen, resetForm, loadMyRequests]);

  // Don't leave the "Added ..." timer running past unmount.
  useEffect(() => {
    return () => {
      if (draftMessage.current) window.clearTimeout(draftMessage.current);
    };
  }, []);

  // After a free-text line is committed it has no catalogue price, so drop the
  // caret straight into its price box instead of making the user find it.
  useEffect(() => {
    const key = pendingPriceFocus.current;
    if (!key) return;
    const el = priceRefs.current[key];
    if (el) {
      el.focus();
      el.select();
      pendingPriceFocus.current = null;
    }
  }, [items]);

  // One suggestion list for the single composer. Matching on barcode as well as
  // name is what makes a hardware scanner work: it types the code and sends
  // Enter, and an exact code match resolves to that product.
  const draftMatches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode || '').includes(q)
      )
      .slice(0, 8);
  }, [draft, products]);

  // Which lines would push stock below zero. Warn rather than block: manual
  // entries are backdated, and the honest record of a discrepancy is more
  // useful than a silent clamp.
  const stockWarnings = useMemo(
    () =>
      items
        .filter((it) => it.product_id)
        .map((it) => {
          const p = products.find((pp) => pp.id === it.product_id);
          if (!p) return null;
          if ((Number(it.quantity) || 0) > p.stock_quantity) {
            return { id: it.product_id, name: p.name, needed: it.quantity, available: p.stock_quantity };
          }
          return null;
        })
        .filter(Boolean) as { id: string; name: string; needed: number; available: number }[],
    [items, products]
  );

  const updateItem = (index: number, patch: Partial<ManualEntryItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  // A scanner types the barcode and sends Enter with nothing highlighted. Resolve
  // an exact code hit to its product; anything else falls through to free text.
  const scannedProduct = useMemo(
    () => products.find((p) => p.barcode && p.barcode === draft.trim()) || null,
    [draft, products]
  );

  const flashDraft = (text: string) => {
    setDraftFlash(text);
    if (draftMessage.current) window.clearTimeout(draftMessage.current);
    draftMessage.current = window.setTimeout(() => setDraftFlash(null), 2500);
  };

  // Return the composer to "add" mode with an empty draft.
  const resetDraft = () => {
    setDraft('');
    setDraftOpen(false);
    setDraftHighlight(-1);
    setEditingKey(null);
  };

  // rAF so focus lands after the rows re-render, not before.
  const focusDraft = () => {
    requestAnimationFrame(() => draftRef.current?.focus());
  };

  const moveHighlight = (delta: number) => {
    if (!draftMatches.length) return;
    setDraftOpen(true);
    setDraftHighlight((cur) => {
      const next = cur + delta;
      if (next < 0) return draftMatches.length - 1;
      if (next >= draftMatches.length) return 0;
      return next;
    });
  };

  /** Load a committed line into the composer for editing. The row itself is not
   *  touched until commit, so cancelling really does leave it as it was. */
  const startEdit = (key: string) => {
    const row = items.find((it) => it._key === key);
    if (!row) return;
    setEditingKey(key);
    setDraft(row.description || '');
    setDraftHighlight(-1);
    setDraftFlash(null);
    draftRef.current?.focus();
  };

  /**
   * Put a catalogue product on the list, mirroring addToCart in the register
   * (src/app/cashier/pos/page.tsx): a repeat pick merges into the existing line
   * and bumps the quantity rather than creating a duplicate. While a line is
   * loaded for editing this replaces that line instead of appending.
   * Stock is intentionally NOT checked here - see stockWarnings; the admin is
   * meant to see the discrepancy at approval rather than have the cashier
   * blocked from transcribing what already happened.
   */
  const commitProduct = (product: SelectableProduct) => {
    const wasEditing = editingKey;

    setItems((prev) => {
      if (wasEditing) {
        return prev.map((it) =>
          it._key === wasEditing
            ? { ...it, product_id: product.id, description: product.name, price: product.price }
            : it
        );
      }
      const existing = prev.findIndex((it) => it.product_id === product.id);
      if (existing >= 0) {
        return prev.map((it, i) =>
          i === existing ? { ...it, quantity: (Number(it.quantity) || 0) + 1 } : it
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          description: product.name,
          quantity: 1,
          price: product.price,
          _key: nextRowKey(),
        },
      ];
    });

    flashDraft(wasEditing ? `Updated line to ${product.name}` : `Added ${product.name}`);
    resetDraft();
    focusDraft();
  };

  const commitFreeText = () => {
    const text = draft.trim();
    if (!text) return;
    const wasEditing = editingKey;
    // Minted out here rather than inside the updater: the updater may not run
    // before this line finishes, so it can't be what hands the key back.
    const newKey = wasEditing ? null : nextRowKey();
    if (newKey) pendingPriceFocus.current = newKey;

    setItems((prev) => {
      if (wasEditing) {
        // Editing the text of a linked line makes it a different line item, so
        // the product link has to go. Approval stores item_name from the
        // description but deducts stock by product_id; a stale link would move
        // inventory for one product while recording another's name.
        return prev.map((it) => {
          if (it._key !== wasEditing) return it;
          const linked = it.product_id ? products.find((p) => p.id === it.product_id) : null;
          return {
            ...it,
            description: text,
            product_id: linked && linked.name === text ? it.product_id : null,
          };
        });
      }
      return [...prev, { product_id: null, description: text, quantity: 1, price: 0, _key: newKey! }];
    });

    flashDraft(wasEditing ? 'Line updated' : 'Added free-text line — set its price');
    resetDraft();
    // Free text has no catalogue price, so send the caret to it instead.
    if (!newKey) focusDraft();
  };

  // Trash always works, including on the last remaining line.
  const removeRow = (index: number) => {
    const removed = items[index];
    setItems((prev) => prev.filter((_, i) => i !== index));
    if (removed) {
      delete priceRefs.current[removed._key];
      if (editingKey === removed._key) resetDraft();
    }
  };

  const loadRequestIntoForm = (req: ManualEntryRequest) => {
    setManualRef(req.manual_ref || '');
    setAtpRef(req.atp_ref || '');
    setTransactionDate(req.transaction_date);
    setSoldBy(req.sold_by || '');
    setBuyerTin(req.buyer_tin || '');
    setBuyerAddress(req.buyer_address || '');
    // Rehydrate with fresh row keys: the stored items carry no _key, and
    // reusing them across a resubmit would let React confuse old and new rows.
    setItems(
      req.items && req.items.length
        ? req.items
            .filter((it) => (it.description || '').trim())
            .map((it) => ({ ...it, _key: nextRowKey() }))
        : []
    );
    resetDraft();
    setPaymentMethod(req.payment_method);
    setReferenceNumber(req.reference_number || '');
    setTermDueDate(req.term_due_date || '');
    setAmountReceived(req.amount_received != null ? String(req.amount_received) : '');
    setNotes(req.notes || '');
    setEditingId(req.id);
    setTab('new');
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);

    const cleanItems = items
      .filter((it) => (it.description || '').trim() !== '')
      .map((it) => ({
        product_id: it.product_id,
        description: (it.description || '').trim(),
        quantity: Math.max(1, parseInt(String(it.quantity)) || 1),
        price: Math.max(0, parseFloat(String(it.price)) || 0),
      }));

    if (cleanItems.length === 0) {
      setError('Add at least one line item with a description.');
      return;
    }
    if (!transactionDate) {
      setError('A receipt date is required.');
      return;
    }
    if (transactionDate > todayIso()) {
      setError('The receipt date cannot be in the future.');
      return;
    }
    if (needsReference && !referenceNumber.trim()) {
      setError(`A reference number is required for ${paymentMethod} payments.`);
      return;
    }
    if (paymentMethod === 'term' && !termDueDate) {
      setError('A due date is required for term sales.');
      return;
    }
    if (paymentMethod === 'term' && termDueDate && termDueDate < transactionDate) {
      setError('The due date cannot be before the receipt date.');
      return;
    }
    if (total <= 0) {
      setError('The total must be greater than zero.');
      return;
    }
    if (!cashierId) {
      setError('Cashier information not found. Please sign in again.');
      return;
    }

    setSubmitting(true);
    try {
      // A rejected entry is corrected in place via resubmit so its row and
      // reserved BIR serial are kept; creating a second row would let two
      // requests compete for the same serial.
      const isResubmit = editingId !== null;
      const payload = {
        p_transaction_date: transactionDate,
        p_items: cleanItems,
        p_payment_method: paymentMethod,
        p_sold_by: soldBy.trim() || null,
        p_manual_ref: manualRef.trim() || null,
        p_atp_ref: atpRef.trim() || null,
        p_buyer_tin: buyerTin.trim() || null,
        p_buyer_address: buyerAddress.trim() || null,
        p_customer_id: null,
        p_reference_number: referenceNumber.trim() || null,
        p_term_due_date: paymentMethod === 'term' ? termDueDate : null,
        p_amount_received: amountReceived.trim() ? parseFloat(amountReceived) : null,
        p_change_amount: amountReceived.trim() ? parseFloat(amountReceived) - total : null,
        p_notes: notes.trim() || null,
      };

      const { data, error: rpcError } = isResubmit
        ? await supabase.rpc('resubmit_manual_entry_request', {
            p_request_id: editingId,
            ...payload,
          })
        : await supabase.rpc('submit_manual_entry_request', {
            p_cashier_id: cashierId,
            p_cashier_username: cashierUsername,
            ...payload,
          });

      if (rpcError) throw rpcError;

      const body = data as { computed_total?: number; total?: number };
      const submittedTotal = body?.computed_total ?? body?.total ?? total;
      setSuccess(
        `${isResubmit ? 'Resubmitted' : 'Submitted'} for approval — ${formatPrice(submittedTotal)}. An admin will review it before it reaches the books.`
      );
      setItems([]);
      setManualRef('');
      setNotes('');
      resetDraft();
      setEditingId(null);
      setTab('mine');
      loadMyRequests();
      onSubmitted();
    } catch (err: any) {
      console.error('Manual entry submit error:', err);
      setError(err.message || 'Failed to submit the manual entry.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = myRequests.filter((r) => r.status === 'pending').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Manual Book Entry"
      size="xl"
    >
      <div className="space-y-6">
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <FileText className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            For sales already written on a BIR-approved manual receipt. This does not
            enter the books or move stock until an admin approves it. Stock is deducted
            at approval, not now.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === 'new' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('new')}
            className="font-bold uppercase text-xs"
          >
            {editingId ? 'Resubmitting' : 'New Entry'}
          </Button>
          <Button
            variant={tab === 'mine' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('mine')}
            className="font-bold uppercase text-xs"
          >
            My Requests{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Button>
        </div>

        {tab === 'mine' ? (
          <div className="space-y-3">
            {requestsLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading your requests...</p>
            ) : myRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">
                You have not submitted any manual entries yet.
              </p>
            ) : (
              myRequests.map((req) => (
                <RequestRow
                  key={req.id}
                  request={req}
                  onResubmit={() => loadRequestIntoForm(req)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {editingId && (
              <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                <p className="text-xs font-bold text-blue-700 dark:text-blue-300">
                  Editing a rejected request. Submitting will return it for approval.
                </p>
                <Button variant="ghost" size="sm" onClick={resetForm} className="text-xs">
                  Cancel edit
                </Button>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}
            {success && (
              <div className="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-green-700 dark:text-green-300">{success}</p>
              </div>
            )}

            {/* --- header fields --- */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  Receipt Date *
                </label>
                <Input
                  type="date"
                  value={transactionDate}
                  max={todayIso()}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  className="h-10 font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  BIR Series / Serial
                </label>
                <Input
                  placeholder="e.g. 0001-12345"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value)}
                  className="h-10 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  ATP No.
                </label>
                <Input
                  placeholder="Authority to Print"
                  value={atpRef}
                  onChange={(e) => setAtpRef(e.target.value)}
                  className="h-10 font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  Sold By
                </label>
                <Input
                  placeholder="Name on the receipt"
                  value={soldBy}
                  onChange={(e) => setSoldBy(e.target.value)}
                  className="h-10 font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  Buyer TIN
                </label>
                <Input
                  placeholder="Optional"
                  value={buyerTin}
                  onChange={(e) => setBuyerTin(e.target.value)}
                  className="h-10 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  Buyer Address
                </label>
                <Input
                  placeholder="Optional"
                  value={buyerAddress}
                  onChange={(e) => setBuyerAddress(e.target.value)}
                  className="h-10 font-bold"
                />
              </div>
            </div>

            {/* --- line items --- */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-black uppercase text-muted-foreground">
                  Line Items *
                </label>
                <span className="text-[10px] font-black uppercase text-muted-foreground">
                  {items.length} {items.length === 1 ? 'line' : 'lines'}
                </span>
              </div>

              {/* The one search bar: searches, scans, accepts free text, and
                  edits a loaded line. Sits above the list, search-then-results,
                  so it is in view the moment the section opens. */}
              <div className="mb-3 pb-3 border-b border-dashed border-border">
                {editingKey && (
                  <div className="mb-1.5 flex items-center gap-2">
                    <Pencil className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-[11px] font-black text-primary truncate">
                      Editing line — Enter updates it, Esc cancels
                    </span>
                    <button
                      type="button"
                      onClick={() => resetDraft()}
                      className="text-[11px] font-black text-muted-foreground hover:text-red-500 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                  <Input
                    ref={draftRef}
                    value={draft}
                    placeholder="Search or scan an item, or type a free-text line..."
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setDraftHighlight(-1);
                      setDraftOpen(true);
                    }}
                    onFocus={() => setDraftOpen(true)}
                    onBlur={() => {
                      // Delay so a click on a suggestion registers first.
                      setTimeout(() => setDraftOpen(false), 150);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        moveHighlight(1);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        moveHighlight(-1);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        // Require an explicit pick, so a partial name never
                        // silently adds the wrong product. A scanner sends
                        // Enter with nothing highlighted, so an exact barcode
                        // still resolves to its product.
                        if (draftHighlight >= 0 && draftMatches[draftHighlight]) {
                          commitProduct(draftMatches[draftHighlight]);
                        } else if (scannedProduct) {
                          commitProduct(scannedProduct);
                        } else {
                          commitFreeText();
                        }
                      } else if (e.key === 'Escape') {
                        if (draftOpen) setDraftOpen(false);
                        else resetDraft();
                      }
                    }}
                    className="h-10 pl-9 pr-9 font-bold"
                  />
                  {draft && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => resetDraft()}
                      title="Clear"
                      aria-label="Clear"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {draftOpen && draftMatches.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 bg-card border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
                      {draftMatches.map((p, i) => {
                        const already = items.some(
                          (it) => it.product_id === p.id && it._key !== editingKey
                        );
                        return (
                          <button
                            key={p.id}
                            type="button"
                            // Keep focus in the box so the next item can be typed
                            // without reaching for the mouse.
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setDraftHighlight(i)}
                            onClick={() => commitProduct(p)}
                            className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 flex items-center justify-between gap-2 ${
                              draftHighlight === i ? 'bg-muted' : 'hover:bg-muted/60'
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-bold truncate">{p.name}</span>
                              <span className="block text-[10px] text-muted-foreground font-medium">
                                {p.barcode ? `Barcode ${p.barcode} - ` : ''}
                                Stock {p.stock_quantity}
                                {already ? ' - in list' : ''}
                              </span>
                            </span>
                            <span className="text-sm font-black text-primary shrink-0">
                              {formatPrice(p.price)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="mt-1 h-4">
                  {draftFlash && (
                    <p className="text-[11px] font-bold text-primary flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {draftFlash}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {items.map((item, index) => {
                  if (!(item.description || '').trim()) return null;
                  return (
                  <div
                    key={item._key}
                    className={`bg-muted/40 border rounded-xl p-3 space-y-2 transition-colors ${
                      editingKey === item._key
                        ? 'border-primary ring-1 ring-primary/30'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(item._key)}
                        title="Edit this line"
                        className="flex-1 min-w-0 text-left h-9 px-2.5 rounded-md hover:bg-muted/70 flex items-center gap-2"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-sm font-bold truncate">{item.description}</span>
                      </button>

                      <div className="w-16 shrink-0">
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(index, {
                              quantity: Math.max(1, parseInt(e.target.value) || 1),
                            })
                          }
                          className="h-9 text-center text-sm font-black"
                        />
                      </div>

                      <div className="w-28 shrink-0">
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-black text-muted-foreground">₱</span>
                          <Input
                            ref={(el) => {
                              priceRefs.current[item._key] = el;
                            }}
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.price === 0 ? '' : item.price}
                            placeholder="0.00"
                            onChange={(e) =>
                              updateItem(index, { price: parseFloat(e.target.value) || 0 })
                            }
                            onKeyDown={(e) => {
                              // Back to the composer so the next line can be typed
                              // without reaching for the mouse.
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                focusDraft();
                              }
                            }}
                            className="h-9 pl-6 text-right text-sm font-black"
                          />
                        </div>
                      </div>

                      <div className="w-24 shrink-0 flex items-center justify-end">
                        <span className="text-sm font-black">
                          {formatPrice((item.price || 0) * (item.quantity || 0))}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        title="Remove this line"
                        aria-label="Remove this line"
                        className="text-muted-foreground hover:text-red-500 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {item.product_id ? (
                      <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        Linked to catalogue — stock will be deducted on approval
                      </p>
                    ) : (
                      item.description && (
                        <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          Free-text line — no stock will be deducted
                        </p>
                      )
                    )}
                  </div>
                  );
                })}
              </div>

            </div>

            {stockWarnings.length > 0 && (
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3">
                <p className="text-xs font-bold text-orange-700 dark:text-orange-300">
                  Stock warning: {stockWarnings.length} line(s) exceed available stock
                </p>
                <ul className="mt-1 space-y-0.5">
                  {stockWarnings.map((w) => (
                    <li key={w.id} className="text-[10px] font-bold text-orange-600 dark:text-orange-400">
                      {w.name}: {w.needed} needed, {w.available} on hand
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-1">
                  This is allowed, but approval will leave a negative balance.
                </p>
              </div>
            )}

            {/* --- totals --- */}
            <div className="bg-muted/50 border border-border rounded-2xl p-4 space-y-2">
              <div className="flex justify-between text-xs font-bold text-muted-foreground">
                <span>VATable Sales</span>
                <span>{formatPrice(vatable)}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-muted-foreground">
                <span>Less VAT ({rate}%)</span>
                <span>{formatPrice(vat)}</span>
              </div>
              <div className="flex justify-between items-center text-lg font-black border-t border-border pt-2">
                <span className="text-sm uppercase">Total</span>
                <span className="text-primary">{formatPrice(total)}</span>
              </div>
            </div>

            {/* --- payment --- */}
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-2">
                  Payment Method *
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setPaymentMethod(m.value)}
                      className={`h-10 rounded-xl border-2 text-[10px] font-black uppercase transition-all ${
                        paymentMethod === m.value
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {needsReference && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                    Reference / Trace Number *
                  </label>
                  <Input
                    placeholder={`Enter ${paymentMethod} reference`}
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="h-10 font-mono font-bold"
                  />
                </div>
              )}

              {paymentMethod === 'term' && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                    Due Date *
                  </label>
                  <Input
                    type="date"
                    min={transactionDate}
                    value={termDueDate}
                    onChange={(e) => setTermDueDate(e.target.value)}
                    className="h-10 font-bold"
                  />
                  <p className="text-[10px] text-muted-foreground font-bold mt-1">
                    This becomes an outstanding balance the customer can pay against.
                  </p>
                </div>
              )}

              {paymentMethod === 'cash' && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                    Amount Tendered
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 font-black text-muted-foreground">₱</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      className="h-10 pl-7 font-bold"
                    />
                  </div>
                  {(parseFloat(amountReceived) || 0) > 0 && change > 0 && (
                    <p className="text-xs font-black text-green-600 mt-1.5">
                      Change: {formatPrice(change)}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase text-muted-foreground mb-1.5">
                  Remarks
                </label>
                <Textarea
                  placeholder="Anything the admin should know"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button
                variant="ghost"
                className="flex-1 font-bold uppercase"
                onClick={onClose}
                disabled={submitting}
              >
                Close
              </Button>
              <Button
                className="flex-[2] font-black uppercase bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleSubmit}
                disabled={submitting || total <= 0}
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RequestRow({
  request,
  onResubmit,
}: {
  request: ManualEntryRequest;
  onResubmit: () => void;
}) {
  const { formatPrice } = useCurrency();

  const icon =
    request.status === 'approved' ? (
      <CheckCircle2 className="h-4 w-4 text-green-600" />
    ) : request.status === 'rejected' ? (
      <XCircle className="h-4 w-4 text-red-600" />
    ) : (
      <Clock className="h-4 w-4 text-amber-600" />
    );

  const badge =
    request.status === 'approved' ? (
      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Approved
      </span>
    ) : request.status === 'rejected' ? (
      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Rejected
      </span>
    ) : (
      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Pending
      </span>
    );

  return (
    <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          {icon}
          <div className="min-w-0">
            <p className="text-sm font-black truncate">
              {request.manual_ref || 'No BIR serial'}
            </p>
            <p className="text-[10px] font-bold text-muted-foreground">
              {new Date(request.transaction_date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
              {' · '}
              {request.items?.length || 0} line(s)
              {' · '}
              {request.payment_method?.toUpperCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          <span className="text-sm font-black text-primary">
            {formatPrice(request.computed_total)}
          </span>
        </div>
      </div>

      {request.review_note && (
        <p className="text-xs font-bold text-muted-foreground bg-card rounded-lg p-2 border border-border">
          Admin: {request.review_note}
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-muted-foreground">
          Submitted {new Date(request.created_at).toLocaleString()}
        </p>
        {request.status === 'rejected' && (
          <Button variant="outline" size="sm" onClick={onResubmit} className="h-7 text-xs font-bold">
            <RotateCcw className="h-3 w-3 mr-1" /> Edit & Resubmit
          </Button>
        )}
      </div>
    </div>
  );
}
