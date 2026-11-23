'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { PAYMENT_LABELS, STATUS_LABELS, useApp } from '@/lib/app-context';
import { supabase } from '@/lib/supabase';
import { formatDate, istDayEnd, istDayStart, money, todayISO } from '@/lib/format';
import { exportElementToA4Pdf, exportToExcel } from '@/lib/export';

interface SalesRegRow {
  receipt_id: string;
  transaction_id: string;
  bill_date: string;
  txn_no: string;
  category_id: string;
  category_name_hi: string;
  receipt_no: string;
  customer_name: string;
  product_details: string;
  quantity: number;
  total_amount: number;
  allocated_paid: number;
  payment_mode: string;
  status: string;
  employee_name: string;
}

interface MasterRegRow {
  id: string;
  txn_no: string;
  bill_date: string;
  customer_name: string;
  receipt_numbers: string;
  receipts_count: number;
  total_amount: number;
  paid_amount: number;
  outstanding: number;
  payment_mode: string;
  payment_status: string;
  status: string;
  employee_name: string;
}

interface ReturnsRegRow {
  id: string;
  return_no: string;
  return_type: string;
  requested_at: string;
  status: string;
  reason: string;
  refund_amount: number;
  goods_value: number;
  txn_no: string;
  receipt_numbers: string;
  products: string;
  quantity: number;
  requested_by_name: string;
}

export default function RegistersPage() {
  const { categories, lang, L, N, settings } = useApp();
  const [tab, setTab] = useState<'daily' | 'category' | 'master' | 'returns'>('daily');
  const [fromDate, setFromDate] = useState(todayISO(0));
  const [toDate, setToDate] = useState(todayISO(0));
  const [catId, setCatId] = useState<string>('all');

  const [salesRows, setSalesRows] = useState<SalesRegRow[]>([]);
  const [masterRows, setMasterRows] = useState<MasterRegRow[]>([]);
  const [returnRows, setReturnRows] = useState<ReturnsRegRow[]>([]);
  const [loading, setLoading] = useState(false);

  const printRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const start = istDayStart(fromDate);
    const end = istDayEnd(toDate);

    if (tab === 'daily' || tab === 'category') {
      let q = supabase
        .from('v_sales_register')
        .select('*')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false });
      if (tab === 'category' && catId !== 'all') q = q.eq('category_id', catId);
      const { data } = await q;
      setSalesRows((data as SalesRegRow[]) || []);
    } else if (tab === 'master') {
      const { data } = await supabase
        .from('v_master_register')
        .select('*')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false });
      setMasterRows((data as MasterRegRow[]) || []);
    } else {
      const { data } = await supabase
        .from('v_returns_register')
        .select('*')
        .gte('requested_at', start)
        .lt('requested_at', end)
        .order('requested_at', { ascending: false });
      setReturnRows((data as ReturnsRegRow[]) || []);
    }
    setLoading(false);
  }, [tab, fromDate, toDate, catId]);

  useEffect(() => {
    load();
  }, [load]);

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  const totalSalesSum = salesRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
  const totalMasterSum = masterRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
  const totalMasterPaid = masterRows.reduce((s, r) => s + Number(r.paid_amount || 0), 0);

  const handleExcel = () => {
    if (tab === 'daily' || tab === 'category') {
      exportToExcel(`sales-register-${fromDate}-to-${toDate}`, [
        {
          name: 'Sales Register',
          headers: ['दिनांक', 'मास्टर बिल', 'श्रेणी', 'रसीद सं.', 'ग्राहक', 'विवरण', 'मात्रा', 'कुल राशि', 'भुगतान', 'कर्मचारी'],
          rows: salesRows.map((r) => [
            r.bill_date,
            r.txn_no,
            r.category_name_hi,
            r.receipt_no,
            r.customer_name || 'नकद',
            r.product_details,
            r.quantity,
            r.total_amount,
            PAYMENT_LABELS[r.payment_mode]?.hi || r.payment_mode,
            r.employee_name,
          ]),
        },
      ]);
    } else if (tab === 'master') {
      exportToExcel(`master-register-${fromDate}-to-${toDate}`, [
        {
          name: 'Master Register',
          headers: ['दिनांक', 'मास्टर बिल', 'रसीद संख्याएं', 'ग्राहक', 'कुल राशि', 'भुगतान', 'बकाया', 'स्थिति', 'कर्मचारी'],
          rows: masterRows.map((r) => [
            r.bill_date,
            r.txn_no,
            r.receipt_numbers,
            r.customer_name || 'नकद',
            r.total_amount,
            r.paid_amount,
            r.outstanding,
            STATUS_LABELS[r.payment_status]?.hi || r.payment_status,
            r.employee_name,
          ]),
        },
      ]);
    } else {
      exportToExcel(`returns-register-${fromDate}-to-${toDate}`, [
        {
          name: 'Returns Register',
          headers: ['वापसी सं.', 'प्रकार', 'मास्टर बिल', 'रसीद सं.', 'उत्पाद', 'मात्रा', 'वापसी राशि', 'कारण', 'स्थिति'],
          rows: returnRows.map((r) => [
            r.return_no,
            r.return_type,
            r.txn_no,
            r.receipt_numbers,
            r.products,
            r.quantity,
            r.refund_amount,
            r.reason,
            STATUS_LABELS[r.status]?.hi || r.status,
          ]),
        },
      ]);
    }
  };

  const handlePdf = async () => {
    if (!printRef.current) return;
    await exportElementToA4Pdf(printRef.current, `register-${tab}-${fromDate}.pdf`, true);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{L('स्वचालित बिक्री रजिस्टर', 'Sales Registers')}</h1>
          <p className="text-sm text-stone-600">
            {L('दैनिक, श्रेणी-वार, मास्टर लेनदेन और वापसी रजिस्टर', 'Daily, Category-wise, Master Transaction & Returns Registers')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExcel}
            className="flex items-center gap-1.5 rounded-xl bg-leaf-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-leaf-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </button>
          <button
            type="button"
            onClick={handlePdf}
            className="flex items-center gap-1.5 rounded-xl bg-khadi-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-khadi-700"
          >
            <Download className="h-4 w-4" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-bold text-stone-800"
          >
            <Printer className="h-4 w-4" />
            {L('प्रिंट', 'Print')}
          </button>
        </div>
      </div>

      {/* Tabs & Date Range */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-khadi-200 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'daily', hi: 'दैनिक बिक्री', en: 'Daily Sales' },
            { id: 'category', hi: 'श्रेणी-वार', en: 'Category-Wise' },
            { id: 'master', hi: 'मास्टर लेनदेन', en: 'Master Txns' },
            { id: 'returns', hi: 'वापसी / रद्द', en: 'Returns' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`rounded-xl px-3.5 py-2 text-sm font-bold ${
                tab === t.id ? 'bg-khadi-600 text-white' : 'bg-stone-100 text-stone-700'
              }`}
            >
              {L(t.hi, t.en)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tab === 'category' && (
            <select
              value={catId}
              onChange={(e) => setCatId(e.target.value)}
              className="rounded-xl border px-3 py-1.5 font-semibold"
            >
              <option value="all">{L('सभी श्रेणियाँ', 'All Categories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_hi}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-xl border px-2.5 py-1.5"
          />
          <span>—</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-xl border px-2.5 py-1.5"
          />
        </div>
      </div>

      {/* Register Table */}
      <div ref={printRef} className="overflow-x-auto rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b pb-2">
          <div className="font-bold text-stone-900">
            {settings?.shop_name} — {L('रजिस्टर', 'Register')} ({formatDate(fromDate)} – {formatDate(toDate)})
          </div>
          <div className="text-sm font-bold text-khadi-800">
            {(tab === 'daily' || tab === 'category') && `${L('कुल योग:', 'Total:')} ${money(totalSalesSum, numStyle, sym)}`}
            {tab === 'master' &&
              `${L('कुल:', 'Total:')} ${money(totalMasterSum, numStyle, sym)} | ${L('प्राप्त:', 'Paid:')} ${money(totalMasterPaid, numStyle, sym)}`}
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-stone-400">{L('लोड हो रहा है...', 'Loading...')}</div>
        ) : tab === 'daily' || tab === 'category' ? (
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b bg-khadi-50 font-bold text-stone-700">
                <th className="px-3 py-2">{L('दिनांक', 'Date')}</th>
                <th className="px-3 py-2">{L('मास्टर बिल', 'Master Txn')}</th>
                <th className="px-3 py-2">{L('श्रेणी', 'Category')}</th>
                <th className="px-3 py-2">{L('रसीद सं.', 'Receipt No')}</th>
                <th className="px-3 py-2">{L('ग्राहक', 'Customer')}</th>
                <th className="px-3 py-2">{L('विवरण', 'Products')}</th>
                <th className="px-3 py-2 text-right">{L('मात्रा', 'Qty')}</th>
                <th className="px-3 py-2 text-right">{L('राशि', 'Amount')}</th>
                <th className="px-3 py-2">{L('भुगतान', 'Mode')}</th>
                <th className="px-3 py-2">{L('कर्मचारी', 'Employee')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {salesRows.map((r) => (
                <tr key={r.receipt_id}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.bill_date)}</td>
                  <td className="px-3 py-2 font-mono font-semibold">{r.txn_no}</td>
                  <td className="px-3 py-2 font-semibold">{r.category_name_hi}</td>
                  <td className="px-3 py-2 font-bold text-red-700">{r.receipt_no}</td>
                  <td className="px-3 py-2">{r.customer_name || L('नकद', 'Cash')}</td>
                  <td className="px-3 py-2 max-w-[240px] truncate">{r.product_details}</td>
                  <td className="px-3 py-2 text-right">{N(r.quantity)}</td>
                  <td className="px-3 py-2 text-right font-bold">{money(r.total_amount, numStyle, sym)}</td>
                  <td className="px-3 py-2">{PAYMENT_LABELS[r.payment_mode]?.[lang] || r.payment_mode}</td>
                  <td className="px-3 py-2">{r.employee_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'master' ? (
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b bg-khadi-50 font-bold text-stone-700">
                <th className="px-3 py-2">{L('दिनांक', 'Date')}</th>
                <th className="px-3 py-2">{L('मास्टर बिल', 'Master Txn')}</th>
                <th className="px-3 py-2">{L('रसीदें', 'Receipts')}</th>
                <th className="px-3 py-2">{L('ग्राहक', 'Customer')}</th>
                <th className="px-3 py-2 text-right">{L('कुल राशि', 'Total')}</th>
                <th className="px-3 py-2 text-right">{L('प्राप्त', 'Paid')}</th>
                <th className="px-3 py-2 text-right">{L('बकाया', 'Due')}</th>
                <th className="px-3 py-2">{L('स्थिति', 'Status')}</th>
                <th className="px-3 py-2">{L('कर्मचारी', 'Employee')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {masterRows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.bill_date)}</td>
                  <td className="px-3 py-2 font-mono font-bold">{r.txn_no}</td>
                  <td className="px-3 py-2 text-xs">{r.receipt_numbers}</td>
                  <td className="px-3 py-2">{r.customer_name || L('नकद', 'Cash')}</td>
                  <td className="px-3 py-2 text-right font-bold">{money(r.total_amount, numStyle, sym)}</td>
                  <td className="px-3 py-2 text-right text-leaf-700">{money(r.paid_amount, numStyle, sym)}</td>
                  <td className="px-3 py-2 text-right text-red-600">{money(r.outstanding, numStyle, sym)}</td>
                  <td className="px-3 py-2">{STATUS_LABELS[r.status]?.[lang] || r.status}</td>
                  <td className="px-3 py-2">{r.employee_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b bg-khadi-50 font-bold text-stone-700">
                <th className="px-3 py-2">{L('वापसी सं.', 'Return No')}</th>
                <th className="px-3 py-2">{L('मास्टर बिल', 'Txn')}</th>
                <th className="px-3 py-2">{L('रसीदें', 'Receipts')}</th>
                <th className="px-3 py-2">{L('उत्पाद', 'Products')}</th>
                <th className="px-3 py-2 text-right">{L('मूल्य', 'Value')}</th>
                <th className="px-3 py-2 text-right">{L('रिफंड', 'Refund')}</th>
                <th className="px-3 py-2">{L('कारण', 'Reason')}</th>
                <th className="px-3 py-2">{L('स्थिति', 'Status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {returnRows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono font-bold">{r.return_no}</td>
                  <td className="px-3 py-2 font-mono">{r.txn_no}</td>
                  <td className="px-3 py-2">{r.receipt_numbers}</td>
                  <td className="px-3 py-2">{r.products}</td>
                  <td className="px-3 py-2 text-right font-bold">{money(r.goods_value, numStyle, sym)}</td>
                  <td className="px-3 py-2 text-right">{money(r.refund_amount, numStyle, sym)}</td>
                  <td className="px-3 py-2">{r.reason}</td>
                  <td className="px-3 py-2 font-bold">{STATUS_LABELS[r.status]?.[lang] || r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
