import type { CartLine, PaymentMode } from './types';

export interface PendingBillPayload {
  idempotency_key: string;
  created_at: string;
  customer: { name: string; mobile: string; address: string; type: string };
  items: { product_id: string; quantity: number; rate: number; discount: number }[];
  bill_discount: number;
  payments: { mode: PaymentMode; amount: number; reference: string }[];
  allocation?: { category_id: string; amount: number }[];
  allow_negative_stock?: boolean;
  notes: string;
  /** Local preview summary so user knows what is queued */
  summary: { total: number; itemsCount: number; customerName: string };
}

const DRAFT_KEY = 'khadi-pos-cart-draft';
const QUEUE_KEY = 'khadi-pos-offline-queue';

export function saveCartDraft(draft: {
  lines: CartLine[];
  customer: { name: string; mobile: string; address: string; type: string };
  billDiscount: number;
  notes: string;
}): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* quota */ }
}

export function loadCartDraft(): {
  lines: CartLine[];
  customer: { name: string; mobile: string; address: string; type: string };
  billDiscount: number;
  notes: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCartDraft(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(DRAFT_KEY);
}

export function getOfflineQueue(): PendingBillPayload[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineBill(bill: PendingBillPayload): PendingBillPayload[] {
  const q = getOfflineQueue();
  if (!q.some((x) => x.idempotency_key === bill.idempotency_key)) {
    q.push(bill);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }
  return q;
}

export function removeOfflineBill(idempotencyKey: string): PendingBillPayload[] {
  const q = getOfflineQueue().filter((x) => x.idempotency_key !== idempotencyKey);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  return q;
}
