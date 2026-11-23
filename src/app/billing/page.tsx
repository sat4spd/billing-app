'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Trash2,
  User,
  Wallet,
} from 'lucide-react';
import { PAYMENT_LABELS, unitLabel, useApp } from '@/lib/app-context';
import { rpc, supabase } from '@/lib/supabase';
import type { CartLine, PaymentMode, StockRow, TransactionDetail } from '@/lib/types';
import { money, moneyDual, round2 } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useUsbBarcodeScanner } from '@/lib/barcode';
import { CameraBarcodeScanner } from '@/components/CameraBarcodeScanner';
import { ReceiptModal } from '@/components/ReceiptModal';
import {
  clearCartDraft,
  enqueueOfflineBill,
  loadCartDraft,
  saveCartDraft,
} from '@/lib/offline-queue';

export default function BillingPage() {
  const { categories, settings, can, lang, L, N, isAdmin, online } = useApp();

  const [products, setProducts] = useState<StockRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');

  const [lines, setLines] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState({ name: '', mobile: '', address: '', type: 'retail' });
  const [showCustomer, setShowCustomer] = useState(false);
  const [billDiscount, setBillDiscount] = useState(0);
  const [notes, setNotes] = useState('');

  // Payment state
  const [payMode, setPayMode] = useState<PaymentMode | 'split'>('cash');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [payRef, setPayRef] = useState('');
  const [splitPayments, setSplitPayments] = useState<{ mode: PaymentMode; amount: string; reference: string }[]>([
    { mode: 'cash', amount: '', reference: '' },
    { mode: 'upi', amount: '', reference: '' },
  ]);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [scanNotice, setScanNotice] = useState('');
  const [completedDetail, setCompletedDetail] = useState<TransactionDetail | null>(null);

  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    const { data, error } = await supabase
      .from('v_stock')
      .select('*')
      .eq('is_active', true)
      .order('name_hi');
    if (!error && data) {
      setProducts(data as StockRow[]);
    }
    setLoadingProducts(false);
  }, []);

  useEffect(() => {
    loadProducts();
    const draft = loadCartDraft();
    if (draft && draft.lines?.length > 0) {
      setLines(draft.lines);
      setCustomer(draft.customer || { name: '', mobile: '', address: '', type: 'retail' });
      setBillDiscount(draft.billDiscount || 0);
      setNotes(draft.notes || '');
    }
  }, [loadProducts]);

  // Persist draft for interrupted billing recovery
  useEffect(() => {
    saveCartDraft({ lines, customer, billDiscount, notes });
  }, [lines, customer, billDiscount, notes]);

  const addProductToCart = useCallback(
    (p: StockRow) => {
      setErr('');
      if (!settings?.allow_negative_stock && !isAdmin && p.quantity <= 0) {
        setErr(L(`${p.name_hi} का स्टॉक उपलब्ध नहीं है`, `${p.name_hi} is out of stock`));
        return;
      }

      const merge = settings?.merge_same_product_in_cart ?? true;
      setLines((prev) => {
        const idx = merge ? prev.findIndex((x) => x.product_id === p.id) : -1;
        if (idx >= 0) {
          const next = [...prev];
          const newQty = round2(next[idx].quantity + 1);
          if (!settings?.allow_negative_stock && !isAdmin && newQty > p.quantity) {
            setErr(L(`अधिकतम उपलब्ध स्टॉक: ${p.quantity}`, `Max available stock: ${p.quantity}`));
            return prev;
          }
          next[idx] = { ...next[idx], quantity: newQty };
          return next;
        }
        return [
          ...prev,
          {
            key: crypto.randomUUID(),
            product_id: p.id,
            product_code: p.product_code,
            barcode: p.barcode,
            name_hi: p.name_hi,
            name_en: p.name_en,
            category_id: p.category_id,
            unit: p.unit,
            list_price: p.selling_price,
            rate: p.selling_price,
            quantity: 1,
            discount: 0,
            gst_rate: 0,
            available: p.quantity,
          },
        ];
      });
    },
    [settings, isAdmin, L],
  );

  const handleBarcodeScan = useCallback(
    (code: string) => {
      const clean = code.trim().toLowerCase();
      const match = products.find(
        (p) =>
          (p.barcode && p.barcode.toLowerCase() === clean) ||
          p.product_code.toLowerCase() === clean,
      );
      if (match) {
        addProductToCart(match);
        setScanNotice(L(`जोड़ा गया: ${match.name_hi}`, `Added: ${match.name_hi}`));
        setTimeout(() => setScanNotice(''), 2000);
      } else {
        setErr(L(`बारकोड "${code}" का उत्पाद नहीं मिला`, `No product found for barcode "${code}"`));
      }
    },
    [products, addProductToCart, L],
  );

  useUsbBarcodeScanner(handleBarcodeScan, !completedDetail && !cameraOpen);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'all' && p.category_id !== catFilter) return false;
      if (!q) return true;
      return (
        p.name_hi.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    });
  }, [products, search, catFilter]);

  // Cart math & category grouping preview
  const subtotal = useMemo(
    () => round2(lines.reduce((acc, l) => acc + round2(l.quantity * l.rate) - l.discount, 0)),
    [lines],
  );
  const grandTotal = Math.max(0, round2(subtotal - (billDiscount || 0)));

  const categorySummary = useMemo(() => {
    const map = new Map<string, { id: string; name_hi: string; color: string; count: number; total: number }>();
    for (const l of lines) {
      const cat = categories.find((c) => c.id === l.category_id);
      const cur = map.get(l.category_id) || {
        id: l.category_id,
        name_hi: cat?.name_hi || 'अन्य',
        color: cat?.color || '#d98b1c',
        count: 0,
        total: 0,
      };
      cur.count += 1;
      cur.total = round2(cur.total + round2(l.quantity * l.rate) - l.discount);
      map.set(l.category_id, cur);
    }
    return Array.from(map.values());
  }, [lines, categories]);

  const effectivePaid = useMemo(() => {
    if (payMode === 'split') {
      return round2(splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    }
    return paidAmount === '' ? grandTotal : round2(Number(paidAmount) || 0);
  }, [payMode, splitPayments, paidAmount, grandTotal]);

  const updateLine = (key: string, patch: Partial<CartLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const clearCart = () => {
    setLines([]);
    setCustomer({ name: '', mobile: '', address: '', type: 'retail' });
    setBillDiscount(0);
    setNotes('');
    setPaidAmount('');
    setPayRef('');
    setErr('');
    idempotencyRef.current = crypto.randomUUID();
    clearCartDraft();
  };

  const handleGenerateBill = async () => {
    if (submitting || lines.length === 0) return;
    setErr('');
    setSubmitting(true);

    const paymentsPayload =
      payMode === 'split'
        ? splitPayments
            .filter((p) => Number(p.amount) > 0)
            .map((p) => ({ mode: p.mode, amount: round2(Number(p.amount)), reference: p.reference }))
        : effectivePaid > 0
        ? [{ mode: payMode, amount: effectivePaid, reference: payRef.trim() }]
        : [];

    const payload = {
      idempotency_key: idempotencyRef.current,
      customer,
      items: lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        rate: l.rate,
        discount: l.discount,
      })),
      bill_discount: billDiscount || 0,
      payments: paymentsPayload,
      notes,
    };

    try {
      if (!online) {
        enqueueOfflineBill({
          ...payload,
          created_at: new Date().toISOString(),
          summary: { total: grandTotal, itemsCount: lines.length, customerName: customer.name },
        });
        clearCart();
        setErr(
          L(
            'इंटरनेट बंद है: बिल ऑफलाइन कतार में सुरक्षित कर लिया गया है। ऑनलाइन होते ही सिंक करें।',
            'Offline: Bill saved to offline queue. Sync when online.',
          ),
        );
        return;
      }

      const res = await rpc<{ id: string; txn_no: string; duplicate: boolean }>('create_bill', {
        p: payload,
      });
      const detail = await rpc<TransactionDetail>('get_transaction_detail', { p_id: res.id });
      setCompletedDetail(detail);
      clearCart();
      await loadProducts();
    } catch (e) {
      setErr(errorMessage(e, lang));
    } finally {
      setSubmitting(false);
    }
  };

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';
  const canEditPrice = can('edit_price');
  const canDiscount = can('discount');
  const enabledPayModes = (settings?.payment_methods || ['cash', 'upi', 'card', 'bank', 'other']) as PaymentMode[];

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 lg:h-[calc(100vh-3rem)] lg:flex-row">
      {/* LEFT: Product Search, Categories & Grid */}
      <section className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-khadi-200 bg-white shadow-sm">
        {/* Search & Barcode Bar */}
        <div className="border-b border-khadi-200 bg-khadi-50/70 p-3 space-y-2.5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" />
              <input
                ref={searchInputRef}
                data-barcode-input="true"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && search.trim()) {
                    const exact = products.find(
                      (p) =>
                        (p.barcode && p.barcode.toLowerCase() === search.trim().toLowerCase()) ||
                        p.product_code.toLowerCase() === search.trim().toLowerCase(),
                    );
                    if (exact) {
                      e.preventDefault();
                      addProductToCart(exact);
                      setSearch('');
                    }
                  }
                }}
                placeholder={L(
                  'उत्पाद खोजें (हिंदी/English नाम, कोड या बारकोड स्कैन करें)...',
                  'Search product (Hindi/English name, SKU or scan barcode)...',
                )}
                className="w-full rounded-xl border border-stone-300 bg-white py-3 pl-10 pr-4 text-base font-medium focus:border-khadi-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-khadi-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-khadi-700"
            >
              <Camera className="h-5 w-5" />
              <span className="hidden sm:inline">{L('स्कैन', 'Scan')}</span>
            </button>
          </div>

          {scanNotice && (
            <div className="flex items-center gap-1.5 rounded-lg bg-leaf-600 px-3 py-1.5 text-xs font-bold text-white">
              <CheckCircle2 className="h-4 w-4" />
              {scanNotice}
            </div>
          )}

          {/* Category Filter Chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCatFilter('all')}
              className={`shrink-0 rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
                catFilter === 'all'
                  ? 'bg-stone-900 text-white'
                  : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100'
              }`}
            >
              {L('सभी', 'All')}
            </button>
            {categories
              .filter((c) => c.is_active)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCatFilter(c.id)}
                  className={`shrink-0 rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
                    catFilter === c.id
                      ? 'text-white shadow'
                      : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100'
                  }`}
                  style={catFilter === c.id ? { backgroundColor: c.color } : undefined}
                >
                  {lang === 'hi' ? c.name_hi : c.name_en || c.name_hi}
                </button>
              ))}
          </div>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loadingProducts ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-stone-100" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-12 text-center text-stone-500">
              {L('कोई उत्पाद नहीं मिला', 'No matching products')}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map((p) => {
                const cat = categories.find((c) => c.id === p.category_id);
                const outOfStock = p.quantity <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProductToCart(p)}
                    className={`flex flex-col justify-between rounded-xl border p-3 text-left transition active:scale-[0.98] ${
                      outOfStock && !settings?.allow_negative_stock && !isAdmin
                        ? 'border-stone-200 bg-stone-50 opacity-60'
                        : 'border-khadi-200 bg-white hover:border-khadi-500 hover:bg-khadi-50/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                          style={{ backgroundColor: cat?.color || '#d98b1c' }}
                        >
                          {p.category_name_hi}
                        </span>
                        <span className="text-[11px] font-mono text-stone-400">{p.product_code}</span>
                      </div>
                      <div className="mt-1.5 line-clamp-2 text-sm font-bold text-stone-900">
                        {p.name_hi}
                      </div>
                      {p.name_en && <div className="truncate text-[11px] text-stone-500">{p.name_en}</div>}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between border-t border-stone-100 pt-1.5">
                      <span className="text-base font-bold text-khadi-800">
                        {money(p.selling_price, numStyle, sym)}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          outOfStock ? 'text-red-600' : p.is_low ? 'text-amber-600' : 'text-stone-500'
                        }`}
                      >
                        {N(p.quantity)} {unitLabel(p.unit, lang)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT: Single Combined Cart & Payment */}
      <section className="flex w-full flex-col overflow-hidden rounded-2xl border border-khadi-200 bg-white shadow-sm lg:w-[460px] xl:w-[500px]">
        {/* Customer Toggle */}
        <div className="border-b border-khadi-200 bg-khadi-50/70 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-stone-900">
              <ShoppingCart className="h-5 w-5 text-khadi-700" />
              <span>{L('खरीदारी कार्ट', 'Shopping Cart')}</span>
              <span className="rounded-full bg-khadi-200 px-2 py-0.5 text-xs font-bold text-khadi-900">
                {N(lines.length)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCustomer((s) => !s)}
                className="flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-bold text-stone-700"
              >
                <User className="h-3.5 w-3.5" />
                {customer.name || L('ग्राहक (वैकल्पिक)', 'Customer (Opt)')}
              </button>
              {lines.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  {L('साफ करें', 'Clear')}
                </button>
              )}
            </div>
          </div>

          {showCustomer && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <input
                type="text"
                value={customer.name}
                onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
                placeholder={L('ग्राहक का नाम', 'Customer Name')}
                className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
              />
              <input
                type="tel"
                value={customer.mobile}
                onChange={(e) => setCustomer((c) => ({ ...c, mobile: e.target.value }))}
                placeholder={L('मोबाइल नंबर', 'Mobile No.')}
                className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
              />
              <input
                type="text"
                value={customer.address}
                onChange={(e) => setCustomer((c) => ({ ...c, address: e.target.value }))}
                placeholder={L('पता (वैकल्पिक)', 'Address (Optional)')}
                className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
              />
              <select
                value={customer.type}
                onChange={(e) => setCustomer((c) => ({ ...c, type: e.target.value }))}
                className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="retail">{L('खुदरा (Retail)', 'Retail')}</option>
                <option value="wholesale">{L('थोक (Wholesale)', 'Wholesale')}</option>
                <option value="institution">{L('संस्था (Institution)', 'Institution')}</option>
              </select>
            </div>
          )}

          {/* Live Category Receipt Preview Pills */}
          {categorySummary.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-bold text-stone-600">
                {L(`${categorySummary.length} अलग रसीदें बनेंगी:`, `${categorySummary.length} receipts:`)}
              </span>
              {categorySummary.map((cs) => (
                <span
                  key={cs.id}
                  className="rounded-md px-2 py-0.5 font-bold text-white"
                  style={{ backgroundColor: cs.color }}
                >
                  {cs.name_hi}: {sym}{cs.total}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto divide-y divide-stone-100 p-2">
          {lines.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-stone-400">
              <QrCode className="mb-2 h-8 w-8 text-stone-300" />
              <p>{L('बाएँ से उत्पाद चुनें या बारकोड स्कैन करें', 'Select products from left or scan barcode')}</p>
            </div>
          ) : (
            lines.map((l) => {
              const cat = categories.find((c) => c.id === l.category_id);
              const lineTotal = round2(l.quantity * l.rate) - l.discount;
              return (
                <div key={l.key} className="p-2 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cat?.color || '#d98b1c' }}
                        />
                        <span className="truncate text-sm font-bold text-stone-900">{l.name_hi}</span>
                      </div>
                      <div className="text-[11px] text-stone-500">
                        {cat?.name_hi} • {unitLabel(l.unit, lang)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.key)}
                      className="rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          l.quantity <= 1
                            ? removeLine(l.key)
                            : updateLine(l.key, { quantity: round2(l.quantity - 1) })
                        }
                        className="rounded-lg border border-stone-300 p-1.5 hover:bg-stone-100"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(l.key, { quantity: Math.max(0.001, Number(e.target.value) || 0) })
                        }
                        className="w-14 rounded-lg border border-stone-300 py-1 text-center text-sm font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => updateLine(l.key, { quantity: round2(l.quantity + 1) })}
                        className="rounded-lg border border-stone-300 p-1.5 hover:bg-stone-100"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-stone-400">×</span>
                      {canEditPrice ? (
                        <input
                          type="number"
                          min="0"
                          value={l.rate}
                          onChange={(e) => updateLine(l.key, { rate: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-20 rounded-lg border border-stone-300 px-2 py-1 text-right text-sm font-semibold"
                        />
                      ) : (
                        <span className="font-semibold text-stone-700">{sym}{l.rate}</span>
                      )}
                    </div>

                    <div className="min-w-[72px] text-right text-sm font-bold text-stone-900">
                      {money(lineTotal, numStyle, sym)}
                    </div>
                  </div>

                  {canDiscount && (
                    <div className="flex items-center justify-end gap-1.5 text-xs">
                      <span className="text-stone-500">{L('छूट:', 'Disc:')}</span>
                      <input
                        type="number"
                        min="0"
                        value={l.discount || ''}
                        onChange={(e) => updateLine(l.key, { discount: Math.max(0, Number(e.target.value) || 0) })}
                        placeholder="0"
                        className="w-16 rounded border border-stone-200 px-1.5 py-0.5 text-right text-xs"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom: Totals, Payment & Generate Bill */}
        <div className="border-t border-khadi-200 bg-khadi-50/80 p-3 space-y-2.5">
          {canDiscount && (
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-stone-700">{L('बिल छूट (₹)', 'Bill Discount (₹)')}</span>
              <input
                type="number"
                min="0"
                value={billDiscount || ''}
                onChange={(e) => setBillDiscount(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
                className="w-24 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-right font-bold"
              />
            </div>
          )}

          {/* Grand Total in Dual Numerals */}
          <div className="flex items-center justify-between rounded-xl bg-amber-100/80 px-3.5 py-2 border border-amber-300">
            <span className="text-base font-bold text-stone-900">{L('कुल योग', 'Grand Total')}</span>
            <div className="text-right">
              <div className="text-lg font-extrabold text-stone-900">
                {moneyDual(grandTotal, sym)}
              </div>
            </div>
          </div>

          {/* Payment Modes */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {enabledPayModes.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPayMode(m)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                    payMode === m
                      ? 'bg-khadi-700 text-white'
                      : 'border border-stone-300 bg-white text-stone-700'
                  }`}
                >
                  {PAYMENT_LABELS[m][lang]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPayMode('split')}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                  payMode === 'split'
                    ? 'bg-khadi-700 text-white'
                    : 'border border-stone-300 bg-white text-stone-700'
                }`}
              >
                {L('मिश्रित', 'Split')}
              </button>
            </div>

            {payMode === 'split' ? (
              <div className="space-y-1.5 rounded-xl border border-stone-200 bg-white p-2">
                {splitPayments.map((sp, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select
                      value={sp.mode}
                      onChange={(e) => {
                        const next = [...splitPayments];
                        next[i].mode = e.target.value as PaymentMode;
                        setSplitPayments(next);
                      }}
                      className="rounded border px-2 py-1 text-xs font-semibold"
                    >
                      {enabledPayModes.map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_LABELS[m][lang]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      value={sp.amount}
                      onChange={(e) => {
                        const next = [...splitPayments];
                        next[i].amount = e.target.value;
                        setSplitPayments(next);
                      }}
                      placeholder={L('राशि', 'Amount')}
                      className="w-24 rounded border px-2 py-1 text-right text-xs font-bold"
                    />
                    <input
                      type="text"
                      value={sp.reference}
                      onChange={(e) => {
                        const next = [...splitPayments];
                        next[i].reference = e.target.value;
                        setSplitPayments(next);
                      }}
                      placeholder={L('रेफरेंस', 'Ref')}
                      className="flex-1 rounded border px-2 py-1 text-xs"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Wallet className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    type="number"
                    min="0"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder={`${L('प्राप्त राशि', 'Paid')} (${grandTotal})`}
                    className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-2.5 text-sm font-bold"
                  />
                </div>
                {payMode !== 'cash' && (
                  <div className="relative flex-1">
                    <CreditCard className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      type="text"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      placeholder={L('UPI / कार्ड Ref', 'UPI / Txn Ref')}
                      className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-2.5 text-sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {err && (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{err}</div>
          )}

          <button
            type="button"
            disabled={submitting || lines.length === 0}
            onClick={handleGenerateBill}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-leaf-600 py-3.5 text-lg font-extrabold text-white shadow-lg transition hover:bg-leaf-700 disabled:opacity-50"
          >
            {submitting
              ? L('बिल बन रहा है...', 'Generating Bill...')
              : L('बिल बनाएं (Generate Bill)', 'Generate Bill')}
          </button>
        </div>
      </section>

      <CameraBarcodeScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={handleBarcodeScan}
      />

      <ReceiptModal detail={completedDetail} onClose={() => setCompletedDetail(null)} />
    </div>
  );
}
