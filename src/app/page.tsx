'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  FileText,
  Package,
  PlusCircle,
  Receipt,
  Settings,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '@/lib/app-context';
import { rpc } from '@/lib/supabase';
import { formatDateTime, money, moneyDual } from '@/lib/format';
import { errorMessage } from '@/lib/errors';

interface DashboardData {
  today_sales: number;
  today_returns: number;
  today_collections: number;
  today_transactions: number;
  today_bills: number;
  pending_returns: number;
  products_total: number;
  stock_units: number;
  low_stock: {
    id: string;
    name_hi: string;
    name_en: string;
    product_code: string;
    unit: string;
    quantity: number;
    min_stock: number;
  }[];
  low_stock_count: number;
  today_by_category: {
    name_hi: string;
    name_en: string;
    color: string;
    bills: number;
    amount: number;
  }[];
  recent: {
    id: string;
    txn_no: string;
    customer_name: string;
    total_amount: number;
    payment_mode: string;
    status: string;
    created_at: string;
    receipts: string;
  }[];
  daily: { day: string; amount: number; txns: number }[];
  monthly: { month: string; amount: number; txns: number }[];
}

export default function DashboardPage() {
  const { L, N, lang, can, settings } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    rpc<DashboardData>('dashboard_stats')
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setErr(errorMessage(e, lang));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lang]);

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  const quickActions = [
    { href: '/billing/', hi: 'नया बिल बनाएं', en: 'New Bill', icon: PlusCircle, perm: 'billing' as const, primary: true },
    { href: '/products/', hi: 'उत्पाद', en: 'Products', icon: Package, perm: 'products.view' as const },
    { href: '/inventory/', hi: 'स्टॉक / इन्वेंटरी', en: 'Inventory', icon: Boxes, perm: 'inventory.view' as const },
    { href: '/registers/', hi: 'बिक्री रजिस्टर', en: 'Sales Register', icon: BookOpen, perm: 'registers' as const },
    { href: '/reports/', hi: 'रिपोर्ट्स', en: 'Reports', icon: BarChart3, perm: 'reports' as const },
    { href: '/settings/', hi: 'सेटिंग्स', en: 'Settings', icon: Settings, perm: 'settings' as const },
  ].filter((a) => !a.perm || can(a.perm));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header + Prominent New Bill CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">
            {L('दुकान डैशबोर्ड', 'Shop Dashboard')}
          </h1>
          <p className="text-sm text-stone-600">
            {L('आज की बिक्री, रसीदें और स्टॉक का सारांश', "Today's sales, receipts and inventory summary")}
          </p>
        </div>
        {can('billing') && (
          <Link
            href="/billing/"
            className="flex items-center gap-2 rounded-2xl bg-leaf-600 px-6 py-3.5 text-lg font-bold text-white shadow-lg transition hover:bg-leaf-700"
          >
            <PlusCircle className="h-6 w-6" />
            <span>{L('नया बिल (New Bill)', 'New Bill')}</span>
          </Link>
        )}
      </div>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {quickActions.map((act) => {
          const Icon = act.icon;
          return (
            <Link
              key={act.href}
              href={act.href}
              className={`flex items-center gap-2.5 rounded-2xl border p-3.5 font-bold shadow-sm transition ${
                act.primary
                  ? 'border-leaf-600 bg-leaf-50 text-leaf-800 hover:bg-leaf-100'
                  : 'border-khadi-200 bg-white text-stone-800 hover:border-khadi-400 hover:bg-khadi-50'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0 text-khadi-700" />
              <span className="text-sm">{L(act.hi, act.en)}</span>
            </Link>
          );
        })}
      </div>

      {err && <div className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{err}</div>}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/80" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-stone-500">
                <span>{L('आज की कुल बिक्री', "Today's Total Sales")}</span>
                <TrendingUp className="h-4 w-4 text-leaf-600" />
              </div>
              <div className="mt-1.5 text-2xl font-bold text-stone-900">
                {money(data.today_sales, numStyle, sym)}
              </div>
              <div className="mt-0.5 text-xs text-stone-500">
                {moneyDual(data.today_sales, sym)}
              </div>
            </div>

            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-stone-500">
                <span>{L('आज की रसीदें / लेनदेन', 'Bills / Transactions')}</span>
                <Receipt className="h-4 w-4 text-khadi-600" />
              </div>
              <div className="mt-1.5 text-2xl font-bold text-stone-900">
                {N(data.today_bills)}{' '}
                <span className="text-sm font-normal text-stone-500">
                  ({N(data.today_transactions)} {L('लेनदेन', 'txns')})
                </span>
              </div>
              <div className="mt-0.5 text-xs text-stone-500">
                {L('संग्रह:', 'Collected:')} {money(data.today_collections, numStyle, sym)}
              </div>
            </div>

            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-stone-500">
                <span>{L('कुल उत्पाद (इन्वेंटरी)', 'Total Products')}</span>
                <Package className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-1.5 text-2xl font-bold text-stone-900">{N(data.products_total)}</div>
              <div className="mt-0.5 text-xs text-stone-500">
                {L('कुल स्टॉक इकाइयाँ:', 'Stock units:')} {N(data.stock_units)}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-700">
                <span>{L('कम स्टॉक उत्पाद', 'Low Stock Products')}</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-1.5 text-2xl font-bold text-amber-700">{N(data.low_stock_count)}</div>
              <div className="mt-0.5 text-xs text-stone-500">
                {L('लंबित वापसी:', 'Pending returns:')} {N(data.pending_returns)}
              </div>
            </div>
          </div>

          {/* Charts: Daily Revenue + Monthly Sales */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-stone-800">
                {L('दैनिक बिक्री (पिछले 30 दिन)', 'Daily Revenue (Last 30 Days)')}
              </h2>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3e8d2" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="amount" name={L('बिक्री (₹)', 'Sales (₹)')} fill="#d98b1c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-stone-800">
                {L('मासिक बिक्री (पिछले 12 माह)', 'Monthly Sales (Last 12 Months)')}
              </h2>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3e8d2" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="amount" name={L('बिक्री (₹)', 'Sales (₹)')} fill="#15803d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Category-wise today + Low stock + Recent transactions */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-bold text-stone-800">
                {L('आज की श्रेणी-वार बिक्री', "Today's Category Sales")}
              </h2>
              {data.today_by_category.length === 0 ? (
                <p className="text-sm text-stone-500">{L('आज अभी कोई बिल नहीं बना है', 'No bills today yet')}</p>
              ) : (
                <div className="space-y-2.5">
                  {data.today_by_category.map((c) => (
                    <div key={c.name_hi} className="flex items-center justify-between rounded-xl bg-khadi-50/70 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                        <div>
                          <div className="text-sm font-bold text-stone-900">{c.name_hi}</div>
                          <div className="text-xs text-stone-500">
                            {N(c.bills)} {L('रसीदें', 'receipts')}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-stone-900">{money(c.amount, numStyle, sym)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-stone-800">{L('कम स्टॉक चेतावनी', 'Low Stock Alerts')}</h2>
                <Link href="/inventory/" className="text-xs font-bold text-khadi-700 hover:underline">
                  {L('सभी देखें', 'View all')}
                </Link>
              </div>
              {data.low_stock.length === 0 ? (
                <p className="text-sm text-leaf-700">{L('सभी उत्पादों का स्टॉक पर्याप्त है', 'All products sufficiently stocked')}</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {data.low_stock.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-stone-900">{p.name_hi}</div>
                        <div className="text-xs text-stone-500">{p.product_code}</div>
                      </div>
                      <div className="text-right text-xs font-bold text-red-700">
                        {N(p.quantity)} / {N(p.min_stock)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-khadi-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-stone-800">{L('हाल के लेनदेन', 'Recent Transactions')}</h2>
                <Link href="/transactions/" className="text-xs font-bold text-khadi-700 hover:underline">
                  {L('इतिहास', 'History')}
                </Link>
              </div>
              {data.recent.length === 0 ? (
                <p className="text-sm text-stone-500">{L('कोई लेनदेन नहीं मिला', 'No recent transactions')}</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {data.recent.map((r) => (
                    <Link
                      key={r.id}
                      href={`/transactions/?id=${r.id}`}
                      className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2 hover:bg-khadi-50"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-bold text-stone-900">
                          <FileText className="h-3.5 w-3.5 text-khadi-600" />
                          <span>{r.txn_no}</span>
                        </div>
                        <div className="truncate text-xs text-stone-500">
                          {r.customer_name || L('नकद ग्राहक', 'Cash')} • {r.receipts}
                        </div>
                        <div className="text-[11px] text-stone-400">{formatDateTime(r.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-stone-900">{money(r.total_amount, numStyle, sym)}</div>
                        <div className="text-[11px] uppercase text-stone-500">{r.payment_mode}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
