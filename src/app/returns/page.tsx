'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import { STATUS_LABELS, useApp } from '@/lib/app-context';
import { rpc, supabase } from '@/lib/supabase';
import { formatDateTime, money } from '@/lib/format';
import { errorMessage } from '@/lib/errors';

interface ReturnRegItem {
  id: string;
  return_no: string;
  return_type: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  goods_value: number;
  refund_amount: number;
  txn_no: string;
  receipt_numbers: string;
  products: string;
  requested_by_name: string;
}

export default function ReturnsPage() {
  const { isAdmin, lang, L, settings } = useApp();
  const [rows, setRows] = useState<ReturnRegItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('v_returns_register')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(100);
    setRows((data as ReturnRegItem[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      if (approve) {
        await rpc('approve_return', { p_return_id: id, p_note: 'Approved' });
      } else {
        await rpc('reject_return', { p_return_id: id, p_note: 'Rejected' });
      }
      await load();
    } catch (ex) {
      alert(errorMessage(ex, lang));
    } finally {
      setBusyId(null);
    }
  };

  const sym = settings?.currency_symbol || '₹';
  const numStyle = settings?.ui_numerals || 'english';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">{L('वापसी एवं रद्दीकरण', 'Returns & Cancellations')}</h1>
        <p className="text-sm text-stone-600">
          {L('लंबित और स्वीकृत बिल रद्दीकरण / माल वापसी का विवरण', 'Pending and processed return/cancellation requests')}
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-khadi-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-khadi-50 text-xs font-bold text-stone-700">
              <th className="px-4 py-3">{L('वापसी सं. / दिनांक', 'Return No')}</th>
              <th className="px-4 py-3">{L('मास्टर बिल / रसीदें', 'Bill / Receipts')}</th>
              <th className="px-4 py-3">{L('उत्पाद व कारण', 'Products & Reason')}</th>
              <th className="px-4 py-3 text-right">{L('रिफंड', 'Refund')}</th>
              <th className="px-4 py-3">{L('स्थिति', 'Status')}</th>
              {isAdmin && <th className="px-4 py-3 text-right">{L('स्वीकृति', 'Decision')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-stone-400">
                  {L('लोड हो रहा है...', 'Loading...')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <div className="font-mono font-bold">{r.return_no}</div>
                    <div className="text-xs text-stone-500">{formatDateTime(r.requested_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold">{r.txn_no}</div>
                    <div className="text-xs text-stone-500">{r.receipt_numbers}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-stone-900">{r.products}</div>
                    <div className="text-xs text-stone-600">{r.reason}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{money(r.refund_amount, numStyle, sym)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        r.status === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : r.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {STATUS_LABELS[r.status]?.[lang] || r.status}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      {r.status === 'pending' && (
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleDecision(r.id, true)}
                            className="flex items-center gap-1 rounded-lg bg-leaf-600 px-2.5 py-1 text-xs font-bold text-white"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {L('स्वीकृत', 'Approve')}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleDecision(r.id, false)}
                            className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white"
                          >
                            <XIcon className="h-3.5 w-3.5" />
                            {L('अस्वीकृत', 'Reject')}
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
