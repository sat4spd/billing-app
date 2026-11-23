'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PAYMENT_LABELS, useApp } from '@/lib/app-context';
import { rpc } from '@/lib/supabase';
import { istDayEnd, istDayStart, money, todayISO } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { exportElementToA4Pdf, exportToExcel } from '@/lib/export';

interface ReportData {
  totals: {
    transactions: number;
    bills: number;
    items_qty: number;
    gross_sales: number;
    discounts: number;
    tax: number;
    returns: number;
    collections: number;
    refunds: number;
    outstanding: number;
  };
  by_category: { id: string; name_hi: string; name_en: string; color: string; bills: number; gross: number; returns: number; net: number; qty: number }[];
  by_product: { product_id: string; name_hi: string; code: string; qty: number; amount: number; returned_qty: number }[];
  by_employee: { created_by: string; name: string; txns: number; amount: number }[];
  by_payment_mode: { mode: string; received: number; refunded: number; net: number; cnt: number }[];
  daily: { day: string; gross: number; txns: number; returns: number; net: number }[];
}

export default function ReportsPage() {
  const { lang, L, N, settings } = useApp();
  const [preset, setPreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom'>('month');
  const [fromDate, setFromDate] = useState(todayISO(-30));
  const [toDate, setToDate] = useState(todayISO(0));
  const [data, setData] = useState<ReportData | null>(null);
  const [err, setErr] = useState('');
  const reportRef = useRef<HTMLDivElement | null>(null);

  const applyPreset = (p: typeof preset) => {
    setPreset(p);
    const today = todayISO(0);
    if (p === 'today') {
      setFromDate(today);
      setToDate(today);
    } else if (p === 'yesterday') {
      const y = todayISO(-1);
      setFromDate(y);
      setToDate(y);
    } else if (p === 'week') {
      setFromDate(todayISO(-6));
      setToDate(today);
    } else if (p === 'month') {
      setFromDate(`${today.slice(0, 7)}-01`);
      setToDate(today);
    } else if (p === 'year') {
      setFromDate(`${today.slice(0, 4)}-01-01`);
      setToDate(today);
    }
  };

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await rpc<ReportData>('report_summary', {
        p_from: istDayStart(fromDate),
        p_to: istDayEnd(toDate),
      });
      setData(res);
    } catch (ex) {
      setErr(errorMessage(ex, lang));
    }
  }, [fromDate, toDate, lang]);

  useEffect(() => {
    load();
  }, [load]);

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  const handleExcel = () => {
    if (!data) return;
    exportToExcel(`khadi-report-${fromDate}-to-${toDate}`, [
      {
        name: 'Summary',
        headers: ['Metric', 'Value'],
        rows: [
          ['Transactions', data.totals.transactions],
          ['Category Bills', data.totals.bills],
          ['Gross Sales', data.totals.gross_sales],
          ['Returns', data.totals.returns],
          ['Net Sales', data.totals.gross_sales - data.totals.returns],
          ['Collections', data.totals.collections],
          ['Outstanding', data.totals.outstanding],
        ],
      },
      {
        name: 'By Category',
        headers: ['Category', 'Bills', 'Qty', 'Gross', 'Returns', 'Net'],
        rows: data.by_category.map((c) => [c.name_hi, c.bills, c.qty, c.gross, c.returns, c.net]),
      },
      {
        name: 'By Product',
        headers: ['Code', 'Product', 'Qty', 'Returned', 'Amount'],
        rows: data.by_product.map((p) => [p.code, p.name_hi, p.qty, p.returned_qty, p.amount]),
      },
      {
        name: 'By Payment Mode',
        headers: ['Mode', 'Count', 'Received', 'Refunded', 'Net'],
        rows: data.by_payment_mode.map((m) => [m.mode, m.cnt, m.received, m.refunded, m.net]),
      },
    ]);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{L('व्यापार रिपोर्ट और विश्लेषण', 'Business Reports & Analytics')}</h1>
          <p className="text-sm text-stone-600">
            {L('मास्टर लेनदेन पर आधारित सटीक आंकड़े (बिना दोहरी गिनती के)', 'Accurate totals from master transactions without double counting')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExcel}
            className="flex items-center gap-1.5 rounded-xl bg-leaf-600 px-3.5 py-2 text-sm font-bold text-white"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel
          </button>
          <button
            type="button"
            onClick={() => reportRef.current && exportElementToA4Pdf(reportRef.current, `report-${fromDate}.pdf`)}
            className="flex items-center gap-1.5 rounded-xl bg-khadi-600 px-3.5 py-2 text-sm font-bold text-white"
          >
            <Download className="h-4 w-4" />
            PDF
          </button>
        </div>
      </div>

      {/* Presets & Dates */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-khadi-200 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'today', hi: 'आज', en: 'Today' },
            { id: 'yesterday', hi: 'कल', en: 'Yesterday' },
            { id: 'week', hi: 'साप्ताहिक', en: 'Weekly' },
            { id: 'month', hi: 'मासिक', en: 'Monthly' },
            { id: 'year', hi: 'वार्षिक', en: 'Yearly' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id as typeof preset)}
              className={`rounded-xl px-3 py-1.5 text-sm font-bold ${
                preset === p.id ? 'bg-khadi-600 text-white' : 'bg-stone-100 text-stone-700'
              }`}
            >
              {L(p.hi, p.en)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setPreset('custom');
              setFromDate(e.target.value);
            }}
            className="rounded-xl border px-2.5 py-1.5"
          />
          <span>—</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setPreset('custom');
              setToDate(e.target.value);
            }}
            className="rounded-xl border px-2.5 py-1.5"
          />
        </div>
      </div>

      {err && <div className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{err}</div>}

      {data && (
        <div ref={reportRef} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-khadi-200 bg-white p-4">
              <div className="text-xs font-semibold text-stone-500">{L('कुल बिक्री', 'Gross Sales')}</div>
              <div className="mt-1 text-2xl font-bold">{money(data.totals.gross_sales, numStyle, sym)}</div>
              <div className="text-xs text-stone-500">
                {N(data.totals.transactions)} {L('लेनदेन', 'txns')} • {N(data.totals.bills)} {L('रसीदें', 'bills')}
              </div>
            </div>
            <div className="rounded-2xl border border-khadi-200 bg-white p-4">
              <div className="text-xs font-semibold text-stone-500">{L('शुद्ध बिक्री', 'Net Sales')}</div>
              <div className="mt-1 text-2xl font-bold text-leaf-700">
                {money(data.totals.gross_sales - data.totals.returns, numStyle, sym)}
              </div>
              <div className="text-xs text-stone-500">
                {L('वापसी:', 'Returns:')} {money(data.totals.returns, numStyle, sym)}
              </div>
            </div>
            <div className="rounded-2xl border border-khadi-200 bg-white p-4">
              <div className="text-xs font-semibold text-stone-500">{L('शुद्ध संग्रह', 'Net Collections')}</div>
              <div className="mt-1 text-2xl font-bold">{money(data.totals.collections, numStyle, sym)}</div>
              <div className="text-xs text-stone-500">
                {L('रिफंड:', 'Refunds:')} {money(data.totals.refunds, numStyle, sym)}
              </div>
            </div>
            <div className="rounded-2xl border border-khadi-200 bg-white p-4">
              <div className="text-xs font-semibold text-stone-500">{L('बकाया / छूट', 'Due / Discounts')}</div>
              <div className="mt-1 text-2xl font-bold text-amber-700">{money(data.totals.outstanding, numStyle, sym)}</div>
              <div className="text-xs text-stone-500">
                {L('छूट:', 'Discounts:')} {money(data.totals.discounts, numStyle, sym)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-khadi-200 bg-white p-4">
            <h2 className="mb-3 font-bold text-stone-900">{L('दैनिक बिक्री ग्राफ', 'Daily Sales Chart')}</h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3e8d2" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="net" name={L('शुद्ध बिक्री', 'Net Sales')} fill="#d98b1c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* By Category */}
            <div className="rounded-2xl border border-khadi-200 bg-white p-4">
              <h2 className="mb-3 font-bold text-stone-900">{L('श्रेणी-वार बिक्री', 'Category-wise Sales')}</h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-stone-500">
                    <th className="py-2">{L('श्रेणी', 'Category')}</th>
                    <th className="py-2 text-right">{L('रसीदें', 'Bills')}</th>
                    <th className="py-2 text-right">{L('शुद्ध राशि', 'Net')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.by_category.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 font-semibold">{c.name_hi}</td>
                      <td className="py-2 text-right">{N(c.bills)}</td>
                      <td className="py-2 text-right font-bold">{money(c.net, numStyle, sym)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By Payment Mode & Employee */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-khadi-200 bg-white p-4">
                <h2 className="mb-3 font-bold text-stone-900">{L('भुगतान माध्यम अनुसार', 'By Payment Mode')}</h2>
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y">
                    {data.by_payment_mode.map((m) => (
                      <tr key={m.mode}>
                        <td className="py-2 font-semibold">{PAYMENT_LABELS[m.mode]?.[lang] || m.mode}</td>
                        <td className="py-2 text-right text-stone-500">{N(m.cnt)}</td>
                        <td className="py-2 text-right font-bold">{money(m.net, numStyle, sym)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-2xl border border-khadi-200 bg-white p-4">
                <h2 className="mb-3 font-bold text-stone-900">{L('कर्मचारी अनुसार बिक्री', 'Employee-wise Sales')}</h2>
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y">
                    {data.by_employee.map((e) => (
                      <tr key={e.created_by}>
                        <td className="py-2 font-semibold">{e.name || 'Staff'}</td>
                        <td className="py-2 text-right text-stone-500">{N(e.txns)} {L('बिल', 'bills')}</td>
                        <td className="py-2 text-right font-bold">{money(e.amount, numStyle, sym)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Top Products */}
          <div className="rounded-2xl border border-khadi-200 bg-white p-4">
            <h2 className="mb-3 font-bold text-stone-900">{L('उत्पाद-वार बिक्री', 'Product-wise Sales')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-stone-500">
                    <th className="py-2">{L('कोड', 'Code')}</th>
                    <th className="py-2">{L('उत्पाद', 'Product')}</th>
                    <th className="py-2 text-right">{L('बिकी मात्रा', 'Qty Sold')}</th>
                    <th className="py-2 text-right">{L('कुल राशि', 'Amount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.by_product.slice(0, 50).map((p) => (
                    <tr key={p.product_id}>
                      <td className="py-2 font-mono text-xs">{p.code}</td>
                      <td className="py-2 font-semibold">{p.name_hi}</td>
                      <td className="py-2 text-right">{N(p.qty)}</td>
                      <td className="py-2 text-right font-bold">{money(p.amount, numStyle, sym)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
