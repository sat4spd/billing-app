'use client';

import React, { useState } from 'react';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import { useApp } from '@/lib/app-context';
import { rpc, supabase } from '@/lib/supabase';
import type { Category } from '@/lib/types';
import { errorMessage } from '@/lib/errors';

export default function CategoriesPage() {
  const { categories, refreshCategories, isAdmin, lang, L } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({
    code: '',
    name_hi: '',
    name_en: '',
    receipt_prefix: '',
    receipt_start_no: '1',
    receipt_heading: '',
    paper_color: '#fbf3b5',
    color: '#d98b1c',
    sort_order: '10',
    is_active: true,
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm({
      code: '',
      name_hi: '',
      name_en: '',
      receipt_prefix: '',
      receipt_start_no: '1',
      receipt_heading: '',
      paper_color: '#fbf3b5',
      color: '#d98b1c',
      sort_order: String((categories.length + 1) * 1),
      is_active: true,
    });
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({
      code: c.code,
      name_hi: c.name_hi,
      name_en: c.name_en,
      receipt_prefix: c.receipt_prefix,
      receipt_start_no: String(c.receipt_start_no),
      receipt_heading: c.receipt_heading || '',
      paper_color: c.receipt_template?.paper_color || '#fbf3b5',
      color: c.color,
      sort_order: String(c.sort_order),
      is_active: c.is_active,
    });
    setErr('');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const payload = {
        code: form.code.trim().toLowerCase() || form.name_en.trim().toLowerCase().replace(/\s+/g, '_'),
        name_hi: form.name_hi.trim(),
        name_en: form.name_en.trim(),
        receipt_prefix: form.receipt_prefix.trim(),
        receipt_start_no: Math.max(1, Number(form.receipt_start_no) || 1),
        receipt_heading: form.receipt_heading.trim() || null,
        receipt_template: { paper_color: form.paper_color },
        color: form.color,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      };
      if (editing) {
        const { error } = await supabase.from('categories').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categories').insert(payload);
        if (error) throw error;
      }
      await refreshCategories();
      setModalOpen(false);
    } catch (ex) {
      setErr(errorMessage(ex, lang));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Category) => {
    if (!confirm(L(`क्या "${c.name_hi}" श्रेणी को हटाना है?`, `Delete category "${c.name_en || c.name_hi}"?`))) return;
    try {
      await rpc('delete_category', { p_id: c.id });
      await refreshCategories();
    } catch (ex) {
      alert(errorMessage(ex, lang));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{L('उत्पाद श्रेणियाँ', 'Product Categories')}</h1>
          <p className="text-sm text-stone-600">
            {L('प्रत्येक श्रेणी की अलग रसीद श्रृंखला और रसीद प्रारूप', 'Separate receipt numbering and template per category')}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-xl bg-khadi-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-khadi-700"
          >
            <Plus className="h-4 w-4" />
            {L('नई श्रेणी', 'New Category')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((c) => (
          <div key={c.id} className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: c.color }} />
                <div>
                  <div className="text-base font-bold text-stone-900">{c.name_hi}</div>
                  <div className="text-xs text-stone-500">{c.name_en} ({c.code})</div>
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEdit(c)} className="rounded p-1.5 hover:bg-stone-100">
                    <Edit3 className="h-4 w-4 text-khadi-700" />
                  </button>
                  <button type="button" onClick={() => handleDelete(c)} className="rounded p-1.5 hover:bg-red-50">
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2 text-xs text-stone-600">
              <span>{L('रसीद उपसर्ग:', 'Prefix:')} <b>{c.receipt_prefix || '—'}</b></span>
              <span>{L('प्रारंभ संख्या:', 'Start No:')} <b>{c.receipt_start_no}</b></span>
              <span className={c.is_active ? 'text-leaf-700 font-bold' : 'text-red-600'}>
                {c.is_active ? L('सक्रिय', 'Active') : L('निष्क्रिय', 'Inactive')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h2 className="font-bold text-stone-900">
                {editing ? L('श्रेणी संपादित करें', 'Edit Category') : L('नई श्रेणी जोड़ें', 'Add Category')}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold">{L('हिंदी नाम *', 'Hindi Name *')}</label>
                <input
                  required
                  value={form.name_hi}
                  onChange={(e) => setForm({ ...form, name_hi: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('अंग्रेजी नाम', 'English Name')}</label>
                <input
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('कोड *', 'Code *')}</label>
                <input
                  required
                  disabled={Boolean(editing)}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono disabled:bg-stone-100"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('रसीद उपसर्ग', 'Receipt Prefix')}</label>
                <input
                  value={form.receipt_prefix}
                  onChange={(e) => setForm({ ...form, receipt_prefix: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="ऊ-"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('प्रारंभ संख्या', 'Start Number')}</label>
                <input
                  type="number"
                  min="1"
                  value={form.receipt_start_no}
                  onChange={(e) => setForm({ ...form, receipt_start_no: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('रसीद शीर्षक (वैकल्पिक)', 'Receipt Heading')}</label>
                <input
                  value={form.receipt_heading}
                  onChange={(e) => setForm({ ...form, receipt_heading: e.target.value })}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('रसीद कागज रंग', 'Receipt Paper Color')}</label>
                <input
                  type="color"
                  value={form.paper_color}
                  onChange={(e) => setForm({ ...form, paper_color: e.target.value })}
                  className="mt-1 h-9 w-full rounded border"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('बैज रंग', 'Badge Color')}</label>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="mt-1 h-9 w-full rounded border"
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  id="cat-act"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <label htmlFor="cat-act" className="text-sm font-semibold">{L('सक्रिय श्रेणी', 'Active')}</label>
              </div>
              {err && <div className="col-span-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{err}</div>}
              <div className="col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl border px-4 py-2 text-sm">
                  {L('रद्द', 'Cancel')}
                </button>
                <button type="submit" disabled={saving} className="rounded-xl bg-khadi-600 px-5 py-2 text-sm font-bold text-white">
                  {saving ? '...' : L('सहेजें', 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
