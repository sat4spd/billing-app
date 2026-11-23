import * as XLSX from 'xlsx';
import html2canvasPro from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { downloadBlob } from './pdf';

export interface ExportSheet {
  name: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

export function exportToExcel(filename: string, sheets: ExportSheet[]): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa = [s.headers, ...s.rows.map((r) => r.map((c) => c ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Auto-fit column widths gently
    ws['!cols'] = s.headers.map((h, idx) => {
      const maxLen = Math.max(
        h.length,
        ...s.rows.map((r) => String(r[idx] ?? '').length),
      );
      return { wch: Math.min(Math.max(maxLen + 3, 10), 42) };
    });
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/**
 * Render an HTML report container (with full Devanagari support) to an A4 PDF.
 */
export async function exportElementToA4Pdf(el: HTMLElement, filename: string, landscape = false): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }
  const canvas = await html2canvasPro(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const imgData = canvas.toDataURL('image/png');
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;

  let yLeft = imgH;
  let position = margin;
  doc.addImage(imgData, 'PNG', margin, position, imgW, imgH, undefined, 'FAST');
  yLeft -= pageH - margin * 2;

  while (yLeft > 0) {
    position = yLeft - imgH + margin;
    doc.addPage();
    doc.addImage(imgData, 'PNG', margin, position, imgW, imgH, undefined, 'FAST');
    yLeft -= pageH - margin * 2;
  }

  const blob = doc.output('blob');
  downloadBlob(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
