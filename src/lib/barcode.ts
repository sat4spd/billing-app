'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * Detects rapid keyboard input from USB / Bluetooth HID barcode scanners
 * (which type digits fast and end with Enter) and triggers `onScan(code)`.
 * Ignores normal typing inside inputs unless the input is the dedicated scan box.
 */
export function useUsbBarcodeScanner(
  onScan: (code: string) => void,
  enabled = true,
): void {
  const bufRef = useRef('');
  const lastTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isBarcodeInput = target?.dataset?.barcodeInput === 'true';
      if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !isBarcodeInput) {
        return;
      }

      const now = Date.now();
      if (now - lastTimeRef.current > 80) {
        bufRef.current = '';
      }
      lastTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = bufRef.current.trim();
        bufRef.current = '';
        if (code.length >= 3) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}

/** Generate a deterministic EAN-13-like or Code128 barcode string from SKU. */
export function generateBarcodeValue(productCode: string): string {
  const clean = productCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (/^\d{8,13}$/.test(clean)) return clean;
  const ts = String(Date.now()).slice(-6);
  return `KH${clean.slice(0, 6)}${ts}`;
}

export function renderBarcodeSvg(svg: SVGSVGElement, value: string, height = 38): void {
  try {
    JsBarcode(svg, value, {
      format: 'CODE128',
      width: 1.6,
      height,
      displayValue: true,
      fontSize: 11,
      margin: 4,
      background: '#ffffff',
      lineColor: '#000000',
    });
  } catch {
    // Fallback if invalid chars
  }
}
