'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, RotateCcw, Search, Wallet, X } from 'lucide-react';
import { PAYMENT_LABELS, STATUS_LABELS, useApp } from '@/lib/app-context';
import { rpc, supabase } from '@/lib/supabase';
import type { PaymentMode, TransactionDetail } from '@/lib/types';
import { formatDateTime, money, todayISO } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { ReceiptModal } from '@/components/ReceiptModal';

interface TxnListRow {
  id: string;
  txn_no: string;
  bill_date: string;
  created_at: string;
  customer_name: string;
  customer_mobile?: string;
  receipt_numbers: string;
  receipts_count: number;
  total_amount: number;
  paid_amount: number;
  outstanding: number;
  payment_mode: string;
  status: string;
  employee_name: string;
}

export default function TransactionsPage() {
  const { lang, L, N, settings, isAdmin } = useApp();
  const [rows, setRows] = useState<TxnListRow[]>([]);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(todayISO(-30));
  const [toDate, setToDate] = useState(todayISO(0));
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [payModal, setPayModal] = useState<TxnListRow | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('cash');
  const [payRef, setPayRef] = useState('');

  const [cancelModal, setCancelModal] = useState<TxnListRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('v_master_register')
      .select('*')
      .gte('bill_date', fromDate)
      .lte('bill_date', toDate)
      .order('created_at', { ascending: false })
      .limit(200);
    setRows((data as TxnListRow[]) || []);
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: string) => {
    const d = await rpc<TransactionDetail>('get_transaction_detail', { p_id: id });
    setDetail(d);
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    setBusy(true);
    setErr('');
    try {
      await rpc('add_payment', {
        p_txn: payModal.id,
        p_mode: payMode,
        p_amount: Number(payAmt),
        p_reference: payRef,
      });
      setPayModal(null);
      setPayAmt('');
      setPayRef('');
      await load();
    } catch (ex) {
      setErr(errorMessage(ex, lang));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModal) return;
    setBusy(true);
    setErr('');
    try {
      await rpc('request_return', {
        p: {
          transaction_id: cancelModal.id,
          type: 'cancellation',
          reason: cancelReason,
          refund_mode: 'cash',
          restock: true,
          auto_approve: isAdmin,
        },
      });
      setCancelModal(null);
      setCancelReason('');
      await load();
    } catch (ex) {
      setErr(errorMessage(ex, lang));
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.txn_no.toLowerCase().includes(q) ||
        (r.receipt_numbers || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{L('बिल इतिहास और खोज', 'Transaction History & Search')}</h1>
        <p className="text-sm text-stone-600">
          {L('रसीद नंबर, मास्टर बिल ID, ग्राहक नाम या दिनांक से खोजें', 'Search by receipt number, master txn ID, customer or date')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2.5 rounded-2xl border border-khadi-200 bg-white p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L('रसीद सं., बिल सं. या ग्राहक नाम...', 'Receipt no, Txn no, or customer...')}
            className="w-full rounded-xl border py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-khadi-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-khadi-50 text-xs font-bold text-stone-700">
              <th className="px-4 py-3">{L('बिल सं. / दिनांक', 'Txn No / Date')}</th>
              <th className="px-4 py-3">{L('श्रेणी रसीदें', 'Category Receipts')}</th>
              <th className="px-4 py-3">{L('ग्राहक', 'Customer')}</th>
              <th className="px-4 py-3 text-right">{L('कुल राशि', 'Total')}</th>
              <th className="px-4 py-3 text-right">{L('बकाया', 'Due')}</th>
              <th className="px-4 py-3">{L('स्थिति', 'Status')}</th>
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
              filtered.map((r) => (
                <tr key={r.id} className="hover:bg-khadi-50/40">
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-bold text-stone-900">{r.txn_no}</div>
                    <div className="text-xs text-stone-500">{formatDateTime(r.created_at)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-stone-700">
                    {r.receipt_numbers} ({N(r.receipts_count)})
                  </td>
                  <td className="px-4 py-2.5">{r.customer_name || L('नकद ग्राहक', 'Cash')}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{money(r.total_amount, numStyle, sym)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${r.outstanding > 0 ? 'text-red-600' : 'text-stone-400'}`}>
                    {money(r.outstanding, numStyle, sym)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        r.status === 'cancelled'
                          ? 'bg-red-100 text-red-700'
                          : r.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {STATUS_LABELS[r.status]?.[lang] || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openDetail(r.id)}
                        className="flex items-center gap-1 rounded-lg bg-khadi-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-khadi-700"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {L('रसीदें', 'Receipts')}
                      </button>
                      {r.outstanding > 0 && r.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayModal(r);
                            setPayAmt(String(r.outstanding));
                            setErr('');
                          }}
                          className="flex items-center gap-1 rounded-lg bg-leaf-600 px-2.5 py-1 text-xs font-bold text-white"
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          {L('भुगतान', 'Pay')}
                        </button>
                      )}
                      {r.status === 'completed' && (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelModal(r);
                            setErr('');
                          }}
                          className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {L('रद्द', 'Cancel')}
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

      {/* Add Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="font-bold">{L('बकाया भुगतान जोड़ें', 'Record Payment')} — {payModal.txn_no}</h2>
              <button type="button" onClick={() => setPayModal(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddPayment} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold">{L('राशि (₹)', 'Amount (₹)')}</label>
                <input
                  type="number"
                  step="0.01"
                  max={payModal.outstanding}
                  required
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="text-xs font-bold">{L('भुगतान माध्यम', 'Mode')}</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value as PaymentMode)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                >
                  {(['cash', 'upi', 'card', 'bank', 'other'] as PaymentMode[]).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABELS[m][lang]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold">{L('संदर्भ (Ref)', 'Reference')}</label>
                <input value={payRef} onChange={(e) => setPayRef(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
              </div>
              {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-leaf-600 py-2.5 font-bold text-white">
                {busy ? '...' : L('भुगतान सहेजें', 'Save Payment')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Request Modal */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="font-bold text-red-700">{L('बिल रद्द करें', 'Cancel Bill')} — {cancelModal.txn_no}</h2>
              <button type="button" onClick={() => setCancelModal(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCancelRequest} className="mt-4 space-y-3">
              <p className="text-xs text-stone-600">
                {isAdmin
                  ? L('प्रशासक के रूप में यह बिल तुरंत रद्द होकर स्टॉक वापस जुड़ जाएगा।', 'As Admin, this bill will be cancelled and stock restored immediately.')
                  : L('रद्दीकरण अनुरोध प्रशासक की स्वीकृति के लिए भेजा जाएगा।', 'Cancellation request will be sent for Admin approval.')}
              </p>
              <div>
                <label className="text-xs font-bold">{L('कारण *', 'Reason *')}</label>
                <textarea
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder={L('रद्द करने का कारण लिखें...', 'Enter reason for cancellation...')}
                />
              </div>
              {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-red-600 py-2.5 font-bold text-white">
                {busy ? '...' : isAdmin ? L('बिल रद्द करें', 'Confirm Cancellation') : L('अनुरोध भेजें', 'Submit Request')}
              </button>
            </form>
          </div>
        </div>
      )}

      <ReceiptModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
