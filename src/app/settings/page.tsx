'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Save, Users } from 'lucide-react';
import { ROLE_LABELS, useApp } from '@/lib/app-context';
import { supabase } from '@/lib/supabase';
import type { AppUser, ReceiptSize, RoleCode, ShopSettings } from '@/lib/types';
import { errorMessage } from '@/lib/errors';
import { downloadBlob } from '@/lib/pdf';

export default function SettingsPage() {
  const { settings, refreshSettings, isAdmin, lang, L } = useApp();
  const [form, setForm] = useState<Partial<ShopSettings>>({});
  const [users, setUsers] = useState<AppUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const loadUsers = useCallback(async () => {
    const { data } = await supabase.from('users').select('*').order('created_at');
    if (data) setUsers(data as AppUser[]);
  }, []);

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin, loadUsers]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const { error } = await supabase
        .from('shop_settings')
        .update({
          shop_name: form.shop_name,
          shop_name_en: form.shop_name_en,
          certification_line: form.certification_line,
          receipt_heading: form.receipt_heading,
          centre_name: form.centre_name,
          gstin: form.gstin,
          address: form.address,
          phone: form.phone,
          footer_note: form.footer_note,
          signature_label: form.signature_label,
          receipt_size: form.receipt_size,
          receipt_font_size: Number(form.receipt_font_size) || 13,
          receipt_paper_color: form.receipt_paper_color,
          receipt_show_english_amount: form.receipt_show_english_amount,
          receipt_numerals: form.receipt_numerals,
          ui_numerals: form.ui_numerals,
          default_language: form.default_language,
          receipt_copies: Number(form.receipt_copies) || 1,
          receipt_numbering_mode: form.receipt_numbering_mode,
          txn_prefix: form.txn_prefix,
          allow_negative_stock: form.allow_negative_stock,
          employee_can_edit_price: form.employee_can_edit_price,
          employee_can_give_discount: form.employee_can_give_discount,
          max_discount_percent: Number(form.max_discount_percent) || 10,
          upi_id: form.upi_id,
        })
        .eq('id', 1);
      if (error) throw error;
      await refreshSettings();
      setMsg(L('सेटिंग्स सहेजी गईं', 'Settings saved successfully'));
    } catch (ex) {
      setMsg(errorMessage(ex, lang));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAsset = async (field: 'logo_url' | 'signature_image_url', file: File) => {
    const ext = file.name.split('.').pop() || 'png';
    const path = `${field}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('shop-assets').upload(path, file, { upsert: true });
    if (error) {
      alert(error.message);
      return;
    }
    const { data: pub } = supabase.storage.from('shop-assets').getPublicUrl(path);
    await supabase.from('shop_settings').update({ [field]: pub.publicUrl }).eq('id', 1);
    await refreshSettings();
  };

  const updateUser = async (u: AppUser, patch: Partial<AppUser>) => {
    const { error } = await supabase.from('users').update(patch).eq('id', u.id);
    if (error) alert(errorMessage(error, lang));
    else loadUsers();
  };

  const handleBackupJson = async () => {
    const [cats, prods, inv, txns, receipts, items, payments, returns] = await Promise.all([
      supabase.from('categories').select('*'),
      supabase.from('products').select('*'),
      supabase.from('inventory').select('*'),
      supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('category_receipts').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('transaction_items').select('*').order('created_at', { ascending: false }).limit(10000),
      supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('returns').select('*'),
    ]);
    const backup = {
      exported_at: new Date().toISOString(),
      shop_settings: settings,
      categories: cats.data,
      products: prods.data,
      inventory: inv.data,
      transactions: txns.data,
      category_receipts: receipts.data,
      transaction_items: items.data,
      payments: payments.data,
      returns: returns.data,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `khadi-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-white p-6 text-center">
        <p className="font-bold text-stone-700">{L('केवल प्रशासक सेटिंग्स बदल सकते हैं', 'Only Administrators can access Settings')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{L('दुकान एवं रसीद सेटिंग्स', 'Shop & Receipt Settings')}</h1>
          <p className="text-sm text-stone-600">{L('रसीद प्रारूप, भाषा, संख्या प्रणाली और कर्मचारी प्रबंधन', 'Receipt layout, numerals, permissions and backup')}</p>
        </div>
        <button
          type="button"
          onClick={handleBackupJson}
          className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-bold hover:bg-stone-50"
        >
          <Download className="h-4 w-4" />
          {L('डेटा बैकअप (JSON)', 'Export Backup (JSON)')}
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-5 rounded-2xl border border-khadi-200 bg-white p-5 shadow-sm">
        <h2 className="border-b pb-2 text-lg font-bold text-stone-900">{L('1. दुकान व रसीद विवरण', '1. Shop & Receipt Header')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold">{L('दुकान का नाम (हिंदी)', 'Shop Name (Hindi)')}</label>
            <input value={form.shop_name || ''} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('प्रमाणन पंक्ति', 'Certification Line')}</label>
            <input value={form.certification_line || ''} onChange={(e) => setForm({ ...form, certification_line: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('रसीद शीर्षक', 'Receipt Heading')}</label>
            <input value={form.receipt_heading || ''} onChange={(e) => setForm({ ...form, receipt_heading: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('GSTIN', 'GSTIN')}</label>
            <input value={form.gstin || ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('केन्द्र का नाम', 'Centre Name')}</label>
            <input value={form.centre_name || ''} onChange={(e) => setForm({ ...form, centre_name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('फोन नंबर', 'Phone')}</label>
            <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold">{L('पता', 'Address')}</label>
            <input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold">{L('फुटर नोट', 'Footer Note')}</label>
            <input value={form.footer_note || ''} onChange={(e) => setForm({ ...form, footer_note: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('हस्ताक्षर लेबल', 'Signature Label')}</label>
            <input value={form.signature_label || ''} onChange={(e) => setForm({ ...form, signature_label: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('दुकान लोगो अपलोड', 'Shop Logo Upload')}</label>
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleUploadAsset('logo_url', e.target.files[0])} className="mt-1 w-full text-xs" />
          </div>
        </div>

        <h2 className="border-b pb-2 pt-2 text-lg font-bold text-stone-900">{L('2. प्रिंट, संख्या व बिलिंग नियम', '2. Print, Numerals & Billing Rules')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs font-bold">{L('रसीद आकार', 'Receipt Size')}</label>
            <select
              value={form.receipt_size || 'traditional'}
              onChange={(e) => setForm({ ...form, receipt_size: e.target.value as ReceiptSize })}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            >
              <option value="traditional">{L('पारंपरिक खादी रसीद', 'Traditional Khadi Memo')}</option>
              <option value="a5">A5 PDF</option>
              <option value="a4">A4 PDF</option>
              <option value="thermal80">80mm Thermal</option>
              <option value="thermal58">58mm Thermal</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold">{L('फॉन्ट साइज (px)', 'Font Size (px)')}</label>
            <input type="number" min={8} max={24} value={form.receipt_font_size || 13} onChange={(e) => setForm({ ...form, receipt_font_size: Number(e.target.value) })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('कागज का रंग', 'Paper Color')}</label>
            <input type="color" value={form.receipt_paper_color || '#fbf3b5'} onChange={(e) => setForm({ ...form, receipt_paper_color: e.target.value })} className="mt-1 h-9 w-full rounded border" />
          </div>
          <div>
            <label className="text-xs font-bold">{L('रसीद अंक प्रणाली', 'Receipt Numerals')}</label>
            <select value={form.receipt_numerals || 'both'} onChange={(e) => setForm({ ...form, receipt_numerals: e.target.value as ShopSettings['receipt_numerals'] })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="both">{L('हिंदी व अंग्रेजी दोनों', 'Both Hindi & English')}</option>
              <option value="hindi">{L('केवल हिंदी (१२३)', 'Hindi Only')}</option>
              <option value="english">{L('केवल अंग्रेजी (123)', 'English Only')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold">{L('रसीद क्रमांक प्रणाली', 'Receipt Numbering')}</label>
            <select value={form.receipt_numbering_mode || 'per_category'} onChange={(e) => setForm({ ...form, receipt_numbering_mode: e.target.value as 'per_category' | 'global' })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              <option value="per_category">{L('प्रत्येक श्रेणी की अलग श्रृंखला', 'Per Category Series')}</option>
              <option value="global">{L('एक समान श्रृंखला', 'Global Series')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold">{L('अधिकतम छूट (%)', 'Max Discount (%)')}</label>
            <input type="number" min={0} max={100} value={form.max_discount_percent ?? 10} onChange={(e) => setForm({ ...form, max_discount_percent: Number(e.target.value) })} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="flex flex-wrap gap-5 pt-1 text-sm font-semibold">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(form.receipt_show_english_amount)} onChange={(e) => setForm({ ...form, receipt_show_english_amount: e.target.checked })} />
            {L('रसीद पर अंग्रेजी राशि भी दिखाएं', 'Show English Amount on Receipt')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(form.employee_can_edit_price)} onChange={(e) => setForm({ ...form, employee_can_edit_price: e.target.checked })} />
            {L('कर्मचारी मूल्य बदल सकते हैं', 'Employees can edit price')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(form.employee_can_give_discount)} onChange={(e) => setForm({ ...form, employee_can_give_discount: e.target.checked })} />
            {L('कर्मचारी छूट दे सकते हैं', 'Employees can give discount')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(form.allow_negative_stock)} onChange={(e) => setForm({ ...form, allow_negative_stock: e.target.checked })} />
            {L('शून्य स्टॉक से कम बिक्री की अनुमति', 'Allow negative stock billing')}
          </label>
        </div>

        {msg && <div className="rounded-xl bg-green-50 px-3 py-2 text-sm font-bold text-green-800">{msg}</div>}

        <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-khadi-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-khadi-700">
          <Save className="h-4 w-4" />
          {saving ? '...' : L('सेटिंग्स सहेजें', 'Save Settings')}
        </button>
      </form>

      {/* Employee & Role Management */}
      <div className="rounded-2xl border border-khadi-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-5 w-5 text-khadi-700" />
          <h2 className="text-lg font-bold text-stone-900">{L('कर्मचारी व भूमिका प्रबंधन', 'User & Role Management')}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-stone-500">
                <th className="py-2">{L('नाम / ईमेल', 'Name / Email')}</th>
                <th className="py-2">{L('भूमिका', 'Role')}</th>
                <th className="py-2">{L('सक्रिय', 'Active')}</th>
                <th className="py-2">{L('विशेष अनुमति', 'Overrides')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5">
                    <div className="font-bold">{u.full_name}</div>
                    <div className="text-xs text-stone-500">{u.email}</div>
                  </td>
                  <td className="py-2.5">
                    <select
                      value={u.role_code}
                      onChange={(e) => updateUser(u, { role_code: e.target.value as RoleCode })}
                      className="rounded-lg border px-2 py-1 text-xs font-bold"
                    >
                      {(['admin', 'employee', 'accountant'] as RoleCode[]).map((rc) => (
                        <option key={rc} value={rc}>
                          {ROLE_LABELS[rc][lang]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5">
                    <input
                      type="checkbox"
                      checked={u.is_active}
                      onChange={(e) => updateUser(u, { is_active: e.target.checked })}
                    />
                  </td>
                  <td className="py-2.5 text-xs space-x-3">
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={u.can_edit_price} onChange={(e) => updateUser(u, { can_edit_price: e.target.checked })} />
                      {L('मूल्य बदलें', 'Edit Price')}
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={u.can_give_discount} onChange={(e) => updateUser(u, { can_give_discount: e.target.checked })} />
                      {L('छूट दें', 'Discount')}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
