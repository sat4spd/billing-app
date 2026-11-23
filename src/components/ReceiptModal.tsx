'use client';

import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, Printer, Share2, X } from 'lucide-react';
import type { TransactionDetail } from '@/lib/types';
import { useApp } from '@/lib/app-context';
import { ReceiptCard } from './ReceiptView';
import { downloadBlob, elementsToPdfBlob, shareReceiptPdf } from '@/lib/pdf';
import { formatAmount, moneyDual } from '@/lib/format';
import { supabase } from '@/lib/supabase';

interface Props {
  detail: TransactionDetail | null;
  onClose: () => void;
}

export function ReceiptModal({ detail, onClose }: Props) {
  const { settings, categories, L } = useApp();
  const [selectedIdx, setSelectedIdx] = useState<number | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  if (!detail || !settings) return null;

  const { transaction: txn, receipts } = detail;
  const visibleReceipts =
    selectedIdx === 'all' ? receipts : receipts[selectedIdx] ? [receipts[selectedIdx]] : receipts;

  const getActiveElements = (): HTMLElement[] => {
    if (selectedIdx === 'all') {
      return receipts.map((_, idx) => cardRefs.current[idx]).filter((el): el is HTMLDivElement => Boolean(el));
    }
    const el = cardRefs.current[selectedIdx];
    return el ? [el] : [];
  };

  const handlePrint = () => {
    window.print();
  };

  const archivePdfToStorage = async (blob: Blob, receiptId: string, receiptNo: string) => {
    try {
      const path = `${txn.txn_no}/${receiptNo}.pdf`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(path, blob, { contentType: 'application/pdf', upsert: true });
      if (!error) {
        await supabase.rpc('set_receipt_pdf', { p_receipt: receiptId, p_path: path });
      }
    } catch {
      // Non-blocking: local download/share still succeeds
    }
  };

  const handleDownloadPdf = async () => {
    setBusy(true);
    try {
      const els = getActiveElements();
      const blob = await elementsToPdfBlob(els, settings.receipt_size);
      const fname =
        selectedIdx === 'all'
          ? `${txn.txn_no}-all-receipts.pdf`
          : `${receipts[selectedIdx].receipt_no}.pdf`;
      downloadBlob(blob, fname);
      if (selectedIdx !== 'all' && receipts[selectedIdx]) {
        void archivePdfToStorage(blob, receipts[selectedIdx].id, receipts[selectedIdx].receipt_no);
      }
      setToast(L('PDF डाउनलोड हो गई', 'PDF downloaded'));
      setTimeout(() => setToast(''), 2500);
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    setBusy(true);
    try {
      const els = getActiveElements();
      const blob = await elementsToPdfBlob(els, settings.receipt_size);
      const fname =
        selectedIdx === 'all'
          ? `${txn.txn_no}-receipts.pdf`
          : `${receipts[selectedIdx].receipt_no}.pdf`;

      const summaryLines = [
        `*${settings.shop_name}*`,
        `${L('बिल सं.', 'Bill No')}: ${txn.txn_no}`,
        ...visibleReceipts.map(
          (r) => `• ${r.category_name_hi} (${r.receipt_no}): ₹${formatAmount(r.total_amount)}`,
        ),
        `${L('कुल योग', 'Grand Total')}: ${moneyDual(txn.total_amount, settings.currency_symbol)}`,
      ].join('\n');

      await shareReceiptPdf({
        blob,
        filename: fname,
        title: `${settings.shop_name} - ${txn.txn_no}`,
        text: summaryLines,
        mobile: txn.customer_mobile,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-900/75 p-2 sm:p-4">
      {/* Top Action Bar (hidden on print) */}
      <div className="no-print mx-auto mb-3 flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="h-6 w-6 text-leaf-600" />
          <div>
            <div className="font-bold text-stone-900">
              {L('बिल संख्या', 'Txn No')}: {txn.txn_no} ({receipts.length}{' '}
              {L('श्रेणी रसीदें', 'Category Receipts')})
            </div>
            <div className="text-xs font-semibold text-stone-600">
              {L('कुल राशि:', 'Total:')} {moneyDual(txn.total_amount, settings.currency_symbol)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-xl bg-khadi-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-khadi-700"
          >
            <Printer className="h-4 w-4" />
            {L('प्रिंट', 'Print')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleDownloadPdf}
            className="flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-bold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            PDF
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-xl bg-leaf-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-leaf-700 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            {L('व्हाट्सएप / शेयर', 'WhatsApp / Share')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Category Tabs if multiple receipts */}
      {receipts.length > 1 && (
        <div className="no-print mx-auto mb-3 flex w-full max-w-5xl flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedIdx('all')}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
              selectedIdx === 'all' ? 'bg-amber-400 text-stone-900 shadow' : 'bg-white/90 text-stone-700'
            }`}
          >
            {L(`सभी रसीदें (${receipts.length})`, `All Receipts (${receipts.length})`)}
          </button>
          {receipts.map((r, idx) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={`rounded-xl px-3.5 py-1.5 text-sm font-bold transition ${
                selectedIdx === idx ? 'bg-amber-400 text-stone-900 shadow' : 'bg-white/90 text-stone-700'
              }`}
            >
              {r.category_name_hi} ({r.receipt_no})
            </button>
          ))}
          {toast && <span className="ml-auto rounded-lg bg-leaf-600 px-3 py-1 text-xs font-bold text-white">{toast}</span>}
        </div>
      )}

      {/* Printable Receipt Area */}
      <div className="print-area mx-auto w-full max-w-5xl flex-1 space-y-6 overflow-y-auto pb-8 print:max-w-none print:space-y-0 print:overflow-visible">
        {visibleReceipts.map((r) => {
          const origIdx = receipts.findIndex((x) => x.id === r.id);
          const cat = categories.find((c) => c.id === r.category_id);
          return (
            <ReceiptCard
              key={r.id}
              receipt={r}
              transaction={txn}
              settings={settings}
              category={cat}
              cardRef={(el) => {
                cardRefs.current[origIdx] = el;
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
