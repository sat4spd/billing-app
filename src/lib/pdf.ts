import html2canvasPro from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import type { ReceiptSize } from './types';

// Exact physical dimensions in mm for jsPDF
const PAPER_MM: Record<ReceiptSize, [number, number]> = {
  a4: [210, 297],
  a5: [148, 210],
  traditional: [140, 215], // Traditional Khadi cash memo pad
  thermal80: [80, 200],    // height grows dynamically
  thermal58: [58, 200],
};

/**
 * Render one or more DOM elements (each representing a category receipt)
 * into a single multi-page PDF Blob. Uses html2canvas-pro so Devanagari
 * conjuncts/matras render identically to the browser (Noto Sans Devanagari).
 */
export async function elementsToPdfBlob(
  elements: HTMLElement[],
  size: ReceiptSize = 'traditional',
): Promise<Blob> {
  if (elements.length === 0) throw new Error('No receipt elements to render');
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const [wMm, defaultHMm] = PAPER_MM[size] || PAPER_MM.traditional;
  const isThermal = size === 'thermal80' || size === 'thermal58';

  let doc: jsPDF | null = null;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const canvas = await html2canvasPro(el, {
      scale: 2.5,
      useCORS: true,
      backgroundColor: null,
      logging: false,
    });
    const imgData = canvas.toDataURL('image/png');
    const ratio = canvas.height / canvas.width;
    const renderHMm = wMm * ratio;
    const pageHMm = isThermal ? Math.max(renderHMm + 4, 80) : defaultHMm;

    if (!doc) {
      doc = new jsPDF({
        orientation: wMm > pageHMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [wMm, pageHMm],
        compress: true,
      });
    } else {
      doc.addPage([wMm, pageHMm], wMm > pageHMm ? 'landscape' : 'portrait');
    }

    const fitRatio = Math.min(1, (pageHMm - 4) / renderHMm);
    const drawW = isThermal ? wMm : wMm * fitRatio;
    const drawH = isThermal ? renderHMm : renderHMm * fitRatio;
    const offsetX = (wMm - drawW) / 2;
    doc.addImage(imgData, 'PNG', offsetX, 2, drawW, drawH, undefined, 'FAST');
  }

  return doc!.output('blob');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Share a PDF via Web Share API (Android / modern browsers), falling back to
 * downloading the PDF and opening WhatsApp with a pre-filled text summary.
 */
export async function shareReceiptPdf(opts: {
  blob: Blob;
  filename: string;
  title: string;
  text: string;
  mobile?: string;
}): Promise<'shared' | 'whatsapp_fallback'> {
  const file = new File([opts.blob], opts.filename, { type: 'application/pdf' });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav && 'canShare' in nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    await nav.share({ files: [file], title: opts.title, text: opts.text });
    return 'shared';
  }

  // Fallback: download the PDF and open WhatsApp Web / app with summary
  downloadBlob(opts.blob, opts.filename);
  const phone = (opts.mobile || '').replace(/\D/g, '');
  const waPhone = phone.length === 10 ? `91${phone}` : phone;
  const waUrl = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(opts.text)}`
    : `https://wa.me/?text=${encodeURIComponent(opts.text)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
  return 'whatsapp_fallback';
}
