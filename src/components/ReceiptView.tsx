'use client';

import React, { useMemo } from 'react';
import type { Category, CategoryReceipt, ReceiptSize, ShopSettings, TransactionRow } from '@/lib/types';
import {
  amountInWordsHi,
  formatAmount,
  formatDate,
  formatTime,
  qty,
  toHindiDigits,
} from '@/lib/format';
import { PAYMENT_LABELS, unitLabel } from '@/lib/app-context';

interface ReceiptCardProps {
  receipt: CategoryReceipt;
  transaction: TransactionRow;
  settings: ShopSettings;
  category?: Category;
  sizeOverride?: ReceiptSize;
  /** Optional ref callback for PDF generation */
  cardRef?: (el: HTMLDivElement | null) => void;
}

const SIZE_WIDTH_CLASSES: Record<ReceiptSize, string> = {
  traditional: 'w-[140mm] max-w-full',
  a5: 'w-[148mm] max-w-full',
  a4: 'w-[196mm] max-w-full',
  thermal80: 'w-[78mm] max-w-full',
  thermal58: 'w-[56mm] max-w-full',
};

/**
 * Renders a single category-wise Khadi Gramodyog Cash Memo closely matching
 * the traditional yellow printed receipt (Receipt.jpeg).
 */
export function ReceiptCard({
  receipt,
  transaction,
  settings,
  category,
  sizeOverride,
  cardRef,
}: ReceiptCardProps) {
  const size = sizeOverride || settings.receipt_size || 'traditional';
  const isThermal = size === 'thermal80' || size === 'thermal58';

  const paperColor =
    category?.receipt_template?.paper_color ||
    settings.receipt_paper_color ||
    '#fbf3b5';

  const heading =
    category?.receipt_heading ||
    category?.receipt_template?.heading ||
    settings.receipt_heading ||
    'कैश मेमो';

  const footerNote =
    category?.receipt_template?.footer_note ||
    settings.footer_note ||
    'नोट : बिका हुआ माल न बदला जायेगा और न वापस होगा ।';

  const fontSize = isThermal
    ? Math.max(10, (settings.receipt_font_size || 13) - 2)
    : settings.receipt_font_size || 13;

  const numStyle = settings.receipt_numerals || 'both';
  const sym = settings.currency_symbol || '₹';

  const formatCellNum = (val: number, decimals: 'auto' | 0 | 2 = 'auto') => {
    const en = formatAmount(val, { decimals });
    if (numStyle === 'hindi') return toHindiDigits(en);
    if (numStyle === 'english') return en;
    return `${toHindiDigits(en)}`;
  };

  const payLabel =
    PAYMENT_LABELS[transaction.payment_mode]?.hi || transaction.payment_mode;

  const copies = settings.receipt_copies || 1;
  const copyArray = useMemo(() => Array.from({ length: copies }, (_, i) => i), [copies]);

  // Minimum blank rows on traditional/A5/A4 pad so it looks like a real Khadi cash memo
  const minRows = isThermal ? 0 : size === 'a4' ? 8 : 5;
  const blankRows = Math.max(0, minRows - receipt.items.length);

  return (
    <>
      {copyArray.map((copyIdx) => (
        <div
          key={`${receipt.id}-copy-${copyIdx}`}
          ref={copyIdx === 0 ? cardRef : undefined}
          style={{
            backgroundColor: isThermal ? '#ffffff' : paperColor,
            fontSize: `${fontSize}px`,
            color: '#18181b',
            fontFamily: '"Noto Sans Devanagari", system-ui, sans-serif',
          }}
          className={`${SIZE_WIDTH_CLASSES[size]} mx-auto border border-stone-800 shadow-sm print:shadow-none ${
            isThermal ? 'p-2.5' : 'p-4 sm:p-5'
          } receipt-page-break`}
        >
          {/* Top Header matching Receipt.jpeg */}
          <div className="text-center leading-snug">
            <div className="flex items-center justify-center gap-2">
              {settings.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.logo_url}
                  alt="Logo"
                  className={isThermal ? 'h-7 w-7 object-contain' : 'h-10 w-10 object-contain'}
                />
              )}
              <div>
                <div className="font-bold tracking-wide" style={{ fontSize: `${fontSize + 1}px` }}>
                  {heading}
                </div>
                {settings.certification_line && (
                  <div className="font-semibold" style={{ fontSize: `${Math.max(fontSize - 1, 10)}px` }}>
                    {settings.certification_line}
                  </div>
                )}
              </div>
            </div>

            <div
              className="mt-0.5 font-bold tracking-tight"
              style={{ fontSize: `${isThermal ? fontSize + 2 : fontSize + 6}px` }}
            >
              {settings.shop_name}
            </div>

            {(settings.address || settings.phone) && (
              <div className="text-[0.8em] text-stone-800">
                {settings.address}
                {settings.address && settings.phone ? ' • ' : ''}
                {settings.phone ? `फोन: ${settings.phone}` : ''}
              </div>
            )}

            {copies > 1 && (
              <div className="text-[0.75em] font-semibold uppercase tracking-wider text-stone-700">
                {copyIdx === 0 ? 'ग्राहक प्रति (Customer Copy)' : `कार्यालय प्रति ${copyIdx + 1}`}
              </div>
            )}
          </div>

          {/* Receipt Number, Centre, GSTIN & Category Badge */}
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-stone-700 pb-1.5 text-[0.9em]">
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-red-700" style={{ fontSize: `${fontSize + 2}px` }}>
                {receipt.receipt_no}
              </span>
              {settings.centre_name && (
                <span>
                  केन्द्र: <span className="font-medium">{settings.centre_name}</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {settings.gstin && <span className="font-semibold">GSTIN : {settings.gstin}</span>}
              <span className="rounded border border-stone-700 px-1.5 py-0.5 text-[0.82em] font-bold">
                श्रेणी: {receipt.category_name_hi}
                {receipt.category_name_en ? ` (${receipt.category_name_en})` : ''}
              </span>
            </div>
          </div>

          {/* Customer & Master Txn Info */}
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[0.92em]">
            <div className="flex-1 min-w-[160px]">
              <span className="font-semibold">ग्राहक श्री </span>
              <span className="inline-block min-w-[120px] border-b border-dotted border-stone-700 px-1 font-semibold">
                {transaction.customer_name || 'नकद ग्राहक (Cash Customer)'}
                {transaction.customer_mobile ? ` (${transaction.customer_mobile})` : ''}
              </span>
            </div>
            <div className="text-[0.82em] text-stone-700">
              बिल सं.: <span className="font-mono font-semibold">{transaction.txn_no}</span>
            </div>
          </div>

          {/* Items Table — Traditional Khadi Columns */}
          <div className="mt-2 overflow-hidden rounded-sm border border-stone-800">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-800 bg-black/[0.04] font-bold">
                  <th className="border-r border-stone-800 px-1.5 py-1">विवरण माल</th>
                  <th className="w-[14%] border-r border-stone-800 px-1.5 py-1 text-center">अदद</th>
                  <th className="w-[18%] border-r border-stone-800 px-1.5 py-1 text-right">दर</th>
                  <th className="w-[22%] px-1.5 py-1 text-right">दाम</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item) => (
                  <tr key={item.id} className="border-b border-stone-400/60 align-top">
                    <td className="border-r border-stone-800 px-1.5 py-1">
                      <div className="font-semibold leading-tight">{item.product_name_hi}</div>
                      {!isThermal && item.product_name_en && (
                        <div className="text-[0.78em] text-stone-700">{item.product_name_en}</div>
                      )}
                      {item.discount > 0 && (
                        <div className="text-[0.75em] text-stone-700">
                          छूट: -{sym}{formatCellNum(item.discount)}
                        </div>
                      )}
                    </td>
                    <td className="border-r border-stone-800 px-1.5 py-1 text-center whitespace-nowrap">
                      {numStyle === 'hindi' ? qty(item.quantity, 'hindi') : qty(item.quantity, 'english')}
                      <span className="block text-[0.75em] text-stone-700">
                        {unitLabel(item.unit, 'hi')}
                      </span>
                    </td>
                    <td className="border-r border-stone-800 px-1.5 py-1 text-right whitespace-nowrap">
                      {formatCellNum(item.rate)}
                    </td>
                    <td className="px-1.5 py-1 text-right font-semibold whitespace-nowrap">
                      {formatCellNum(item.line_total)}
                    </td>
                  </tr>
                ))}

                {Array.from({ length: blankRows }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className="h-6 border-b border-stone-400/30">
                    <td className="border-r border-stone-800" />
                    <td className="border-r border-stone-800" />
                    <td className="border-r border-stone-800" />
                    <td />
                  </tr>
                ))}

                {receipt.bill_discount > 0 && (
                  <tr className="border-t border-stone-700 bg-black/[0.02] text-[0.9em]">
                    <td colSpan={3} className="border-r border-stone-800 px-1.5 py-1 text-right font-semibold">
                      बिल छूट (Discount)
                    </td>
                    <td className="px-1.5 py-1 text-right font-semibold">
                      -{formatCellNum(receipt.bill_discount)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals Section matching Receipt.jpeg: तारीख | योग | राशि */}
          <div className="mt-2 grid grid-cols-12 items-center border border-stone-800">
            <div className="col-span-6 border-r border-stone-800 px-2 py-1.5 text-[0.88em]">
              <div>
                <span className="font-semibold">तारीख: </span>
                <span>{formatDate(receipt.created_at, numStyle === 'hindi' ? 'hindi' : 'english')}</span>
                <span className="ml-1 text-[0.85em] text-stone-700">
                  {formatTime(receipt.created_at, 'english')}
                </span>
              </div>
              <div className="text-[0.85em]">
                भुगतान: <span className="font-semibold">{payLabel}</span>
                {receipt.allocated_paid > 0 && (
                  <span className="ml-1">
                    ({sym}{formatAmount(receipt.allocated_paid)})
                  </span>
                )}
              </div>
            </div>
            <div className="col-span-2 border-r border-stone-800 px-1.5 py-1.5 text-center font-bold">
              योग
            </div>
            <div className="col-span-4 px-2 py-1 text-right">
              <div className="font-bold leading-tight" style={{ fontSize: `${fontSize + 3}px` }}>
                {sym} {toHindiDigits(formatAmount(receipt.total_amount))}
              </div>
              {settings.receipt_show_english_amount && (
                <div className="text-[0.85em] font-semibold text-stone-800">
                  ({sym} {formatAmount(receipt.total_amount)})
                </div>
              )}
            </div>
          </div>

          {/* Amount in Hindi words & Tax info */}
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[0.8em]">
            <div>
              <span className="font-semibold">अक्षरे: </span>
              <span>{amountInWordsHi(receipt.total_amount)}</span>
            </div>
            {receipt.tax_amount > 0 && (
              <div className="text-stone-700">
                GST ({settings.prices_include_gst ? 'शामिल' : 'अतिरिक्त'}): {sym}{formatAmount(receipt.tax_amount)}
              </div>
            )}
          </div>

          {receipt.status === 'cancelled' && (
            <div className="mt-1.5 rounded border-2 border-red-700 bg-red-100/80 py-0.5 text-center font-bold text-red-800">
              रद्द रसीद (CANCELLED)
            </div>
          )}

          {/* Footer Note & Signature */}
          <div className="mt-2 border-t border-stone-700 pt-1.5 text-[0.84em] font-medium">
            {footerNote}
          </div>

          <div className="mt-5 flex items-end justify-between text-[0.85em]">
            <div>
              <span>तारीख: {formatDate(receipt.created_at, 'english')}</span>
            </div>
            <div className="text-center">
              {settings.signature_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.signature_image_url}
                  alt="Signature"
                  className="mx-auto mb-1 h-8 object-contain"
                />
              )}
              <div className="border-t border-stone-800 px-3 pt-0.5 font-semibold">
                {settings.signature_label || 'हस्ताक्षर विक्रेता'}
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
