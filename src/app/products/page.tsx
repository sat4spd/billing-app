'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Barcode, Edit3, Plus, Printer, Search, X } from 'lucide-react';
import { UNITS, unitLabel, useApp } from '@/lib/app-context';
import { rpc, supabase } from '@/lib/supabase';
import type { StockRow } from '@/lib/types';
import { money } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { generateBarcodeValue } from '@/lib/barcode';
import { BarcodeLabelPrinter } from '@/components/BarcodeLabelPrinter';

export default function ProductsPage() {
  const { categories, isAdmin, can, lang, L, N, settings } = useApp();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name_hi: '',
    name_en: '',
    category_id: '',
    product_code: '',
    barcode: '',
    selling_price: '',
    purchase_price: '',
    unit: 'piece',
    opening_stock: '0',
    min_stock: '2',
    gst_rate: '0',
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Barcode label printing state
  const [labelItems, setLabelItems] = useState<{ product: StockRow; copies: number }[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('v_stock').select('*').order('name_hi');
    if (data) setRows(data as StockRow[]);

    if (can('purchase_price')) {
      const { data: costData } = await supabase.from('product_costs').select('product_id,purchase_price');
      if (costData) {
        const m: Record<string, number> = {};
        for (const c of costData as { product_id: string; purchase_price: number }[]) {
          m[c.product_id] = c.purchase_price;
        }
        setCosts(m);
      }
    }
    setLoading(false);
  }, [can]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditingId(null);
    setForm({
      name_hi: '',
      name_en: '',
      category_id: categories[0]?.id || '',
      product_code: '',
      barcode: '',
      selling_price: '',
      purchase_price: '',
      unit: 'piece',
      opening_stock: '0',
      min_stock: '2',
      gst_rate: '0',
      is_active: true,
    });
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (p: StockRow) => {
    setEditingId(p.id);
    setForm({
      name_hi: p.name_hi,
      name_en: p.name_en,
      category_id: p.category_id,
      product_code: p.product_code,
      barcode: p.barcode || '',
      selling_price: String(p.selling_price),
      purchase_price: costs[p.id] !== undefined ? String(costs[p.id]) : '',
      unit: p.unit,
      opening_stock: String(p.opening_stock),
      min_stock: String(p.min_stock),
      gst_rate: '0',
      is_active: p.is_active,
    });
    setErr('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await rpc('save_product', {
        p: {
          id: editingId,
          name_hi: form.name_hi,
          name_en: form.name_en,
          category_id: form.category_id,
          product_code: form.product_code,
          barcode: form.barcode,
          selling_price: Number(form.selling_price),
          purchase_price: form.purchase_price !== '' ? Number(form.purchase_price) : null,
          unit: form.unit,
          opening_stock: editingId ? undefined : Number(form.opening_stock || 0),
          min_stock: Number(form.min_stock || 0),
          gst_rate: Number(form.gst_rate || 0),
          is_active: form.is_active,
        },
      });
      setModalOpen(false);
      await load();
    } catch (ex) {
      setErr(errorMessage(ex, lang));
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (catFilter !== 'all' && r.category_id !== catFilter) return false;
      if (!q) return true;
      return (
        r.name_hi.toLowerCase().includes(q) ||
        r.name_en.toLowerCase().includes(q) ||
        r.product_code.toLowerCase().includes(q) ||
        (r.barcode && r.barcode.toLowerCase().includes(q))
      );
    });
  }, [rows, search, catFilter]);

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{L('उत्पाद मास्टर', 'Product Master')}</h1>
          <p className="text-sm text-stone-600">
            {L('सभी श्रेणियों के उत्पाद, मूल्य और बारकोड प्रबंधन', 'Products, pricing and barcode management')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setLabelItems(filtered.slice(0, 30).map((p) => ({ product: p, copies: 1 })))
              }
              className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-bold text-stone-800 hover:bg-stone-50"
            >
              <Printer className="h-4 w-4" />
              {L('बारकोड लेबल प्रिंट', 'Print Barcode Labels')}
            </button>
          )}
          {can('products.add') && (
            <button
              type="button"
              onClick={openNew}
              className="flex items-center gap-1.5 rounded-xl bg-khadi-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-khadi-700"
            >
              <Plus className="h-4 w-4" />
              {L('नया उत्पाद जोड़ें', 'Add Product')}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5 rounded-2xl border border-khadi-200 bg-white p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L('नाम, SKU या बारकोड से खोजें...', 'Search by name, SKU or barcode...')}
            className="w-full rounded-xl border border-stone-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold"
        >
          <option value="all">{L('सभी श्रेणियाँ', 'All Categories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_hi} ({c.name_en})
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-khadi-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-khadi-200 bg-khadi-50 text-xs font-bold text-stone-700">
              <th className="px-4 py-3">{L('कोड / बारकोड', 'SKU / Barcode')}</th>
              <th className="px-4 py-3">{L('उत्पाद का नाम', 'Product Name')}</th>
              <th className="px-4 py-3">{L('श्रेणी', 'Category')}</th>
              <th className="px-4 py-3 text-right">{L('बिक्री मूल्य', 'Selling Price')}</th>
              {can('purchase_price') && (
                <th className="px-4 py-3 text-right">{L('क्रय मूल्य', 'Purchase Price')}</th>
              )}
              <th className="px-4 py-3 text-right">{L('स्टॉक', 'Stock')}</th>
              <th className="px-4 py-3 text-right">{L('कार्रवाई', 'Actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-stone-400">
                  {L('लोड हो रहा है...', 'Loading...')}
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className={!p.is_active ? 'bg-stone-50 opacity-60' : 'hover:bg-khadi-50/40'}>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <div className="font-bold text-stone-800">{p.product_code}</div>
                    <div className="text-stone-500">{p.barcode || '—'}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-stone-900">{p.name_hi}</div>
                    {p.name_en && <div className="text-xs text-stone-500">{p.name_en}</div>}
                  </td>
                  <td className="px-4 py-2.5">{p.category_name_hi}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{money(p.selling_price, numStyle, sym)}</td>
                  {can('purchase_price') && (
                    <td className="px-4 py-2.5 text-right text-stone-600">
                      {costs[p.id] !== undefined ? money(costs[p.id], numStyle, sym) : '—'}
                    </td>
                  )}
                  <td className={`px-4 py-2.5 text-right font-bold ${p.is_low ? 'text-red-600' : 'text-stone-800'}`}>
                    {N(p.quantity)} {unitLabel(p.unit, lang)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setLabelItems([{ product: p, copies: 6 }])}
                        title={L('बारकोड प्रिंट', 'Print Barcode')}
                        className="rounded-lg p-1.5 text-stone-600 hover:bg-stone-100"
                      >
                        <Barcode className="h-4 w-4" />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          title={L('संपादित करें', 'Edit')}
                          className="rounded-lg p-1.5 text-khadi-700 hover:bg-khadi-100"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="text-lg font-bold text-stone-900">
                {editingId ? L('उत्पाद संपादित करें', 'Edit Product') : L('नया उत्पाद जोड़ें', 'Add New Product')}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="p-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-stone-700">{L('हिंदी नाम *', 'Hindi Name *')}</label>
                <input
                  required
                  value={form.name_hi}
                  onChange={(e) => setForm({ ...form, name_hi: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="उदा. ऊनी शॉल"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-bold text-stone-700">{L('अंग्रेजी नाम', 'English Name')}</label>
                <input
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="e.g. Woollen Shawl"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('श्रेणी *', 'Category *')}</label>
                <select
                  required
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name_hi} ({c.name_en})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('इकाई', 'Unit')}</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {UNITS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.hi} ({u.en})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('SKU / कोड (खाली = स्वतः)', 'SKU (blank = auto)')}</label>
                <input
                  value={form.product_code}
                  onChange={(e) => setForm({ ...form, product_code: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('बारकोड (वैकल्पिक)', 'Barcode (optional)')}</label>
                <div className="mt-1 flex gap-1">
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    className="w-full rounded-xl border px-3 py-2 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        barcode: generateBarcodeValue(f.product_code || f.name_en || 'KHADI'),
                      }))
                    }
                    className="shrink-0 rounded-xl border bg-stone-50 px-2.5 text-xs font-bold hover:bg-stone-100"
                  >
                    {L('बनाएं', 'Gen')}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('बिक्री मूल्य (₹) *', 'Selling Price *')}</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={form.selling_price}
                  onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-bold"
                />
              </div>
              {isAdmin && (
                <div>
                  <label className="text-xs font-bold text-stone-700">{L('क्रय मूल्य (केवल प्रशासक)', 'Purchase Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.purchase_price}
                    onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              )}
              {!editingId && (
                <div>
                  <label className="text-xs font-bold text-stone-700">{L('प्रारंभिक स्टॉक', 'Opening Stock')}</label>
                  <input
                    type="number"
                    step="any"
                    value={form.opening_stock}
                    onChange={(e) => setForm({ ...form, opening_stock: e.target.value })}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-stone-700">{L('न्यूनतम स्टॉक अलर्ट', 'Min Stock Alert')}</label>
                <input
                  type="number"
                  step="any"
                  value={form.min_stock}
                  onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-700">{L('GST दर (%)', 'GST Rate (%)')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.gst_rate}
                  onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input
                  id="prod-active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <label htmlFor="prod-active" className="text-sm font-semibold">
                  {L('सक्रिय उत्पाद', 'Active Product')}
                </label>
              </div>

              {err && <div className="sm:col-span-2 rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-700">{err}</div>}

              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold"
                >
                  {L('रद्द करें', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-khadi-600 px-5 py-2 text-sm font-bold text-white hover:bg-khadi-700 disabled:opacity-50"
                >
                  {saving ? L('सहेज रहा है...', 'Saving...') : L('सहेजें', 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <BarcodeLabelPrinter
        open={Boolean(labelItems)}
        onClose={() => setLabelItems(null)}
        items={labelItems || []}
      />
    </div>
  );
}
