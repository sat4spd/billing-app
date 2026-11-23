'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, History, Search, X } from 'lucide-react';
import { unitLabel, useApp } from '@/lib/app-context';
import { rpc, supabase } from '@/lib/supabase';
import type { StockRow } from '@/lib/types';
import { formatDateTime, money } from '@/lib/format';
import { errorMessage } from '@/lib/errors';

interface MovementRow {
  id: number;
  product_id: string;
  movement_type: string;
  quantity: number;
  balance_after: number;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
  products?: { name_hi: string; product_code: string };
}

export default function InventoryPage() {
  const { categories, isAdmin, can, lang, L, N, settings } = useApp();
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [tab, setTab] = useState<'stock' | 'low' | 'movements'>('stock');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const [entryModal, setEntryModal] = useState<{ product: StockRow; type: 'purchase' | 'adjustment_in' | 'adjustment_out' | 'damaged' } | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [refInput, setRefInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('v_stock').select('*').order('name_hi');
    if (data) setStock(data as StockRow[]);

    if (can('registers') || isAdmin) {
      const { data: mv } = await supabase
        .from('stock_movements')
        .select('id,product_id,movement_type,quantity,balance_after,reference_no,notes,created_at,products(name_hi,product_code)')
        .order('created_at', { ascending: false })
        .limit(150);
      if (mv) setMovements(mv as unknown as MovementRow[]);
    }
  }, [can, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredStock = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stock.filter((s) => {
      if (tab === 'low' && !s.is_low) return false;
      if (catFilter !== 'all' && s.category_id !== catFilter) return false;
      if (!q) return true;
      return (
        s.name_hi.toLowerCase().includes(q) ||
        s.name_en.toLowerCase().includes(q) ||
        s.product_code.toLowerCase().includes(q)
      );
    });
  }, [stock, tab, catFilter, search]);

  const totalValue = useMemo(
    () => stock.reduce((acc, s) => acc + Math.max(0, s.quantity) * s.selling_price, 0),
    [stock],
  );

  const handleStockEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryModal) return;
    setBusy(true);
    setErr('');
    try {
      await rpc('stock_entry', {
        p: {
          product_id: entryModal.product.id,
          type: entryModal.type,
          quantity: Number(qtyInput),
          unit_cost: costInput !== '' ? Number(costInput) : null,
          reference_no: refInput,
          notes: notesInput,
        },
      });
      setEntryModal(null);
      setQtyInput('');
      setCostInput('');
      setRefInput('');
      setNotesInput('');
      await load();
    } catch (ex) {
      setErr(errorMessage(ex, lang));
    } finally {
      setBusy(false);
    }
  };

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{L('स्टॉक एवं इन्वेंटरी', 'Inventory Management')}</h1>
          <p className="text-sm text-stone-600">
            {L('वर्तमान स्टॉक, खरीद प्रविष्टि, क्षतिग्रस्त स्टॉक और स्टॉक इतिहास', 'Current stock, purchase entry, damaged stock and movement log')}
          </p>
        </div>
        <div className="rounded-xl border border-khadi-200 bg-white px-4 py-2 text-right">
          <div className="text-xs text-stone-500">{L('अनुमानित स्टॉक मूल्य (बिक्री दर)', 'Stock Valuation (Retail)')}</div>
          <div className="text-lg font-bold text-stone-900">{money(totalValue, numStyle, sym)}</div>
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-khadi-200 bg-white p-3">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setTab('stock')}
            className={`rounded-xl px-3.5 py-2 text-sm font-bold ${tab === 'stock' ? 'bg-khadi-600 text-white' : 'bg-stone-100 text-stone-700'}`}
          >
            {L('सभी स्टॉक', 'All Stock')} ({N(stock.length)})
          </button>
          <button
            type="button"
            onClick={() => setTab('low')}
            className={`rounded-xl px-3.5 py-2 text-sm font-bold ${tab === 'low' ? 'bg-amber-600 text-white' : 'bg-stone-100 text-stone-700'}`}
          >
            {L('कम स्टॉक', 'Low Stock')} ({N(stock.filter((s) => s.is_low).length)})
          </button>
          {(isAdmin || can('registers')) && (
            <button
              type="button"
              onClick={() => setTab('movements')}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold ${tab === 'movements' ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-700'}`}
            >
              <History className="h-4 w-4" />
              {L('स्टॉक इतिहास', 'Movements')}
            </button>
          )}
        </div>

        {tab !== 'movements' && (
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={L('खोजें...', 'Search...')}
                className="rounded-xl border py-1.5 pl-8 pr-3 text-sm"
              />
            </div>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-xl border px-3 py-1.5 text-sm font-semibold"
            >
              <option value="all">{L('सभी श्रेणियाँ', 'All Categories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_hi}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {tab === 'movements' ? (
        <div className="overflow-x-auto rounded-2xl border border-khadi-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b bg-khadi-50 text-xs font-bold text-stone-700">
                <th className="px-4 py-3">{L('दिनांक', 'Date')}</th>
                <th className="px-4 py-3">{L('उत्पाद', 'Product')}</th>
                <th className="px-4 py-3">{L('प्रकार', 'Type')}</th>
                <th className="px-4 py-3 text-right">{L('मात्रा', 'Qty')}</th>
                <th className="px-4 py-3 text-right">{L('शेष स्टॉक', 'Balance')}</th>
                <th className="px-4 py-3">{L('संदर्भ / टिप्पणी', 'Reference / Notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 text-xs text-stone-600">{formatDateTime(m.created_at)}</td>
                  <td className="px-4 py-2.5 font-semibold">{m.products?.name_hi || m.product_id}</td>
                  <td className="px-4 py-2.5 text-xs uppercase font-bold text-stone-600">{m.movement_type}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${m.quantity >= 0 ? 'text-leaf-700' : 'text-red-600'}`}>
                    {m.quantity >= 0 ? `+${m.quantity}` : m.quantity}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold">{N(m.balance_after)}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-600">
                    {m.reference_no} {m.notes ? `— ${m.notes}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-khadi-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b bg-khadi-50 text-xs font-bold text-stone-700">
                <th className="px-4 py-3">{L('उत्पाद', 'Product')}</th>
                <th className="px-4 py-3">{L('श्रेणी', 'Category')}</th>
                <th className="px-4 py-3 text-right">{L('प्रारंभिक', 'Opening')}</th>
                <th className="px-4 py-3 text-right">{L('वर्तमान स्टॉक', 'Current')}</th>
                <th className="px-4 py-3 text-right">{L('न्यूनतम', 'Min')}</th>
                {isAdmin && <th className="px-4 py-3 text-right">{L('स्टॉक प्रविष्टि', 'Stock Entry')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filteredStock.map((s) => (
                <tr key={s.id} className="hover:bg-khadi-50/40">
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-stone-900">{s.name_hi}</div>
                    <div className="text-xs text-stone-500">{s.product_code}</div>
                  </td>
                  <td className="px-4 py-2.5">{s.category_name_hi}</td>
                  <td className="px-4 py-2.5 text-right text-stone-600">{N(s.opening_stock)}</td>
                  <td className={`px-4 py-2.5 text-right font-extrabold ${s.is_low ? 'text-red-600' : 'text-leaf-700'}`}>
                    {N(s.quantity)} {unitLabel(s.unit, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-stone-500">{N(s.min_stock)}</td>
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEntryModal({ product: s, type: 'purchase' })}
                          className="flex items-center gap-1 rounded-lg bg-leaf-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-leaf-700"
                        >
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                          {L('खरीद +', 'Purchase +')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryModal({ product: s, type: 'adjustment_out' })}
                          className="flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-bold text-stone-700 hover:bg-stone-100"
                        >
                          <ArrowDownCircle className="h-3.5 w-3.5" />
                          {L('समायोजन', 'Adjust')}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="font-bold text-stone-900">{entryModal.product.name_hi}</h2>
              <button type="button" onClick={() => setEntryModal(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleStockEntry} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-stone-700">{L('प्रविष्टि प्रकार', 'Movement Type')}</label>
                <select
                  value={entryModal.type}
                  onChange={(e) =>
                    setEntryModal({
                      ...entryModal,
                      type: e.target.value as 'purchase' | 'adjustment_in' | 'adjustment_out' | 'damaged',
                    })
                  }
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-semibold"
                >
                  <option value="purchase">{L('नई खरीद (+)', 'Purchase (+)')}</option>
                  <option value="adjustment_in">{L('स्टॉक वृद्धि (+)', 'Adjustment In (+)')}</option>
                  <option value="adjustment_out">{L('स्टॉक कमी (-)', 'Adjustment Out (-)')}</option>
                  <option value="damaged">{L('क्षतिग्रस्त माल (-)', 'Damaged Stock (-)')}</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('मात्रा *', 'Quantity *')}</label>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  required
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-bold"
                />
              </div>
              {entryModal.type === 'purchase' && (
                <div>
                  <label className="text-xs font-bold text-stone-700">{L('क्रय दर (₹)', 'Unit Cost (₹)')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-stone-700">{L('संदर्भ / चालान सं.', 'Reference / Challan No.')}</label>
                <input
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('टिप्पणी', 'Notes')}</label>
                <input
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              {err && <div className="rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{err}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEntryModal(null)} className="rounded-xl border px-4 py-2 text-sm">
                  {L('रद्द', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-khadi-600 px-5 py-2 text-sm font-bold text-white"
                >
                  {busy ? '...' : L('सहेजें', 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
