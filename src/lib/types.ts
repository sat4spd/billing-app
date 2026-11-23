export type RoleCode = 'admin' | 'employee' | 'accountant';
export type PaymentMode = 'cash' | 'upi' | 'card' | 'bank' | 'other';
export type ReceiptSize = 'a4' | 'a5' | 'thermal80' | 'thermal58' | 'traditional';
export type Numerals = 'hindi' | 'english' | 'both';

export interface AppUser {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_code: RoleCode;
  is_active: boolean;
  can_edit_price: boolean;
  can_give_discount: boolean;
  created_at: string;
}

export interface ShopSettings {
  id: number;
  shop_name: string;
  shop_name_en: string;
  certification_line: string;
  receipt_heading: string;
  centre_name: string;
  gstin: string;
  address: string;
  phone: string;
  email: string;
  footer_note: string;
  signature_label: string;
  signature_image_url: string | null;
  logo_url: string | null;
  currency_symbol: string;
  receipt_size: ReceiptSize;
  receipt_font_size: number;
  receipt_paper_color: string;
  receipt_show_english_amount: boolean;
  receipt_numerals: Numerals;
  ui_numerals: 'hindi' | 'english';
  default_language: 'hi' | 'en';
  receipt_copies: number;
  receipt_numbering_mode: 'per_category' | 'global';
  txn_prefix: string;
  prices_include_gst: boolean;
  allow_negative_stock: boolean;
  employee_can_edit_price: boolean;
  employee_can_give_discount: boolean;
  max_discount_percent: number;
  merge_same_product_in_cart: boolean;
  payment_methods: PaymentMode[];
  upi_id: string;
  printer_settings: Record<string, unknown>;
  updated_at: string;
}

export interface Category {
  id: string;
  code: string;
  name_hi: string;
  name_en: string;
  receipt_prefix: string;
  receipt_start_no: number;
  receipt_heading: string | null;
  receipt_template: { paper_color?: string; footer_note?: string; heading?: string };
  color: string;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  product_code: string;
  barcode: string | null;
  name_hi: string;
  name_en: string;
  category_id: string;
  selling_price: number;
  unit: string;
  min_stock: number;
  gst_rate: number;
  hsn_code: string;
  image_url: string | null;
  is_active: boolean;
  search_text?: string;
}

/** Product joined with stock (v_stock view). */
export interface StockRow {
  id: string;
  product_code: string;
  barcode: string | null;
  name_hi: string;
  name_en: string;
  category_id: string;
  category_name_hi: string;
  category_name_en: string;
  unit: string;
  selling_price: number;
  min_stock: number;
  is_active: boolean;
  opening_stock: number;
  quantity: number;
  is_low: boolean;
}

export interface CartLine {
  key: string; // local line id
  product_id: string | null; // null for unlisted / custom items
  product_code: string;
  barcode: string | null;
  name_hi: string;
  name_en: string;
  category_id: string;
  unit: string;
  list_price: number;
  rate: number;
  quantity: number;
  discount: number;
  gst_rate: number;
  available: number;
  is_custom?: boolean;
}

export interface TransactionRow {
  id: string;
  txn_no: string;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string;
  customer_address: string;
  customer_type: string;
  items_count: number;
  gross_amount: number;
  line_discount: number;
  bill_discount: number;
  total_amount: number;
  tax_amount: number;
  paid_amount: number;
  outstanding: number;
  refunded_amount: number;
  returned_amount: number;
  payment_mode: string;
  payment_status: 'paid' | 'partial' | 'unpaid' | 'refunded';
  status: 'completed' | 'partially_returned' | 'returned' | 'cancelled';
  notes: string;
  created_by: string;
  created_at: string;
  cancelled_at: string | null;
  employee_name?: string;
}

export interface TransactionItem {
  id: string;
  transaction_id: string;
  receipt_id: string;
  category_id: string;
  product_id: string | null;
  line_no: number;
  product_code: string;
  product_name_hi: string;
  product_name_en: string;
  unit: string;
  quantity: number;
  list_price: number;
  rate: number;
  discount: number;
  gst_rate: number;
  tax_amount: number;
  line_total: number;
  returned_qty: number;
}

export interface CategoryReceipt {
  id: string;
  transaction_id: string;
  category_id: string;
  receipt_seq: number;
  receipt_no: string;
  category_name_hi: string;
  category_name_en: string;
  items_count: number;
  gross_amount: number;
  line_discount: number;
  bill_discount: number;
  total_amount: number;
  tax_amount: number;
  allocated_paid: number;
  returned_amount: number;
  status: string;
  pdf_path: string | null;
  created_at: string;
  items: TransactionItem[];
}

export interface Payment {
  id: string;
  transaction_id: string;
  kind: 'payment' | 'refund';
  mode: string;
  amount: number;
  reference: string;
  created_at: string;
}

export interface ReturnRow {
  id: string;
  return_no: string;
  transaction_id: string;
  return_type: 'return' | 'cancellation';
  reason: string;
  return_value: number;
  refund_amount: number;
  refund_mode: string;
  restock: boolean;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  decision_note: string;
  items?: { id: string; transaction_item_id: string; receipt_id: string; product_id: string; quantity: number; amount: number }[];
}

export interface TransactionDetail {
  transaction: TransactionRow;
  receipts: CategoryReceipt[];
  payments: Payment[];
  returns: ReturnRow[];
}
