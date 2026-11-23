'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { renderBarcodeSvg } from '@/lib/barcode';
import type { StockRow } from '@/lib/types';
import { formatAmount } from '@/lib/format';
import { useApp } from '@/lib/app-context';

interface Props {
  open: boolean;
  onClose: () => void;
  items: { product: StockRow; copies: number }[];
}

function SingleLabel({ product, shopName }: { product: StockRow; shopName: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const code = product.barcode || product.product_code;

  useEffect(() => {
    if (svgRef.current && code) {
      renderBarcodeSvg(svgRef.current, code, 36);
    }
  }, [code]);

  return (
    <div className="flex flex-col items-center justify-between rounded border border-dashed border-stone-400 bg-white p-2 text-center">
      <div className="w-full truncate text-[10px] font-bold text-stone-700">{shopName}</div>
      <div className="w-full truncate text-xs font-bold text-stone-900">{product.name_hi}</div>
      <svg ref={svgRef} className="my-0.5 max-w-full" />
      <div className="flex w-full items-center justify-between text-[11px] font-bold text-stone-800">
        <span>{product.product_code}</span>
        <span>₹{formatAmount(product.selling_price)}</span>
      </div>
    </div>
  );
}

export function BarcodeLabelPrinter({ open, onClose, items }: Props) {
  const { settings, L } = useApp();
  const [cols, setCols] = useState(3);
  if (!open) return null;

  const shopName = settings?.shop_name || 'खादी ग्रामोद्योग';
  const expanded = items.flatMap((it) =>
    Array.from({ length: Math.max(1, it.copies) }, (_, idx) => ({
      key: `${it.product.id}-${idx}`,
      product: it.product,
    })),
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-900/70 p-4">
      <div className="no-print mx-auto mb-3 flex w-full max-w-4xl items-center justify-between rounded-xl bg-white px-4 py-3 shadow">
        <div className="font-bold text-stone-800">
          {L('बारकोड लेबल प्रिंट पूर्वावलोकन', 'Barcode Label Print Preview')} ({expanded.length})
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <span>{L('कॉलम:', 'Cols:')}</span>
            <select
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
              className="rounded border px-2 py-1 text-sm"
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-khadi-600 px-4 py-2 text-sm font-semibold text-white hover:bg-khadi-700"
          >
            <Printer className="h-4 w-4" />
            {L('प्रिंट करें', 'Print')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="print-area mx-auto w-full max-w-4xl flex-1 overflow-auto rounded-xl bg-white p-4 shadow print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {expanded.map((e) => (
            <SingleLabel key={e.key} product={e.product} shopName={shopName} />
          ))}
        </div>
      </div>
    </div>
  );
}
