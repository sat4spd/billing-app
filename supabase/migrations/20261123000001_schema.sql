-- =====================================================================
-- Khadi Gramodyog Billing & Inventory — Core schema
-- =====================================================================
-- Design notes
--  * One master `transactions` row per customer purchase.
--  * `transaction_items` holds every cart line (any category).
--  * `category_receipts` = one row per (transaction, category). Each item
--    points at exactly one receipt; receipt.category_id = item.category_id
--    is enforced by a composite FK.
--  * `payments` are recorded once per transaction (never per receipt) so
--    sales/payment totals are never double counted. The per-receipt share
--    of the payment lives in `category_receipts.allocated_paid`.
--  * Completed sales and stock movements are never deleted (triggers block
--    DELETE); corrections happen through returns / cancellations.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Roles & users
-- ---------------------------------------------------------------------
create table if not exists public.roles (
  code        text primary key,               -- admin | employee | accountant
  name_hi     text not null,
  name_en     text not null,
  permissions jsonb not null default '{}'::jsonb
);

create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete restrict,
  full_name   text not null default '',
  email       text,
  phone       text,
  role_code   text not null default 'employee' references public.roles(code),
  is_active   boolean not null default true,
  -- Per-user overrides (admin may grant an employee price edit etc.)
  can_edit_price     boolean not null default false,
  can_give_discount  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists users_role_idx on public.users(role_code);

-- ---------------------------------------------------------------------
-- Shop settings (single row, id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.shop_settings (
  id                     int primary key default 1 check (id = 1),
  shop_name              text not null default 'छोटानागपुर खादी ग्रामोद्योग संस्थान',
  shop_name_en           text not null default 'Chotanagpur Khadi Gramodyog Sansthan',
  certification_line     text not null default 'खादी ग्रामोद्योग आयोग द्वारा प्रमाणित',
  receipt_heading        text not null default 'कैश मेमो',
  centre_name            text not null default '',          -- "केन्द्र"
  gstin                  text not null default '20AAAAC4947R1ZJ',
  address                text not null default '',
  phone                  text not null default '',
  email                  text not null default '',
  footer_note            text not null default 'नोट : बिका हुआ माल न बदला जायेगा और न वापस होगा ।',
  signature_label        text not null default 'हस्ताक्षर विक्रेता',
  signature_image_url    text,
  logo_url               text,
  currency_symbol        text not null default '₹',
  -- Receipt format
  receipt_size           text not null default 'traditional'
                         check (receipt_size in ('a4','a5','thermal80','thermal58','traditional')),
  receipt_font_size      int  not null default 13 check (receipt_font_size between 8 and 24),
  receipt_paper_color    text not null default '#fbf3b5',
  receipt_show_english_amount boolean not null default true,
  receipt_numerals       text not null default 'both' check (receipt_numerals in ('hindi','english','both')),
  ui_numerals            text not null default 'english' check (ui_numerals in ('hindi','english')),
  default_language       text not null default 'hi' check (default_language in ('hi','en')),
  receipt_copies         int  not null default 1 check (receipt_copies between 1 and 3),
  -- Numbering
  receipt_numbering_mode text not null default 'per_category'
                         check (receipt_numbering_mode in ('per_category','global')),
  txn_prefix             text not null default 'TXN',
  -- Business rules
  prices_include_gst     boolean not null default true,
  allow_negative_stock   boolean not null default false,
  employee_can_edit_price    boolean not null default false,
  employee_can_give_discount boolean not null default false,
  max_discount_percent   numeric(5,2) not null default 10,
  merge_same_product_in_cart boolean not null default true,
  payment_methods        jsonb not null default '["cash","upi","card","bank","other"]'::jsonb,
  upi_id                 text not null default '',
  printer_settings       jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);

-- ---------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name_hi          text not null,
  name_en          text not null default '',
  receipt_prefix   text not null default '',
  receipt_start_no int  not null default 1 check (receipt_start_no >= 1),
  receipt_heading  text,                         -- optional override of shop heading
  receipt_template jsonb not null default '{}'::jsonb,  -- e.g. {"paper_color":"#fde68a","footer_note":"..."}
  color            text not null default '#f59e0b',
  sort_order       int  not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Receipt counters: key = category id (per-category mode) or 'global'.
create table if not exists public.receipt_counters (
  counter_key text primary key,
  last_no     bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Products & inventory
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  product_code    text not null unique,              -- SKU
  barcode         text unique,                       -- nullable: barcode is never mandatory
  name_hi         text not null,
  name_en         text not null default '',
  category_id     uuid not null references public.categories(id) on delete restrict,
  selling_price   numeric(12,2) not null check (selling_price >= 0),
  unit            text not null default 'piece',
  min_stock       numeric(12,3) not null default 0,
  gst_rate        numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 28),
  hsn_code        text not null default '',
  image_url       text,
  is_active       boolean not null default true,
  search_text     text generated always as (
                    lower(coalesce(name_hi,'') || ' ' || coalesce(name_en,'') || ' ' ||
                          coalesce(product_code,'') || ' ' || coalesce(barcode,''))) stored,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_search_idx on public.products(search_text);

-- Purchase price kept in a separate table so it can be admin/accountant only (RLS).
create table if not exists public.product_costs (
  product_id     uuid primary key references public.products(id) on delete cascade,
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  updated_at     timestamptz not null default now()
);

create table if not exists public.inventory (
  product_id     uuid primary key references public.products(id) on delete restrict,
  opening_stock  numeric(12,3) not null default 0,
  quantity       numeric(12,3) not null default 0,
  updated_at     timestamptz not null default now()
);

do $$ begin
  create type public.movement_type as enum
    ('opening','purchase','sale','sale_cancel','return','adjustment_in','adjustment_out','damaged');
exception when duplicate_object then null; end $$;

create table if not exists public.stock_movements (
  id             bigint generated always as identity primary key,
  product_id     uuid not null references public.products(id) on delete restrict,
  movement_type  public.movement_type not null,
  quantity       numeric(12,3) not null,       -- signed: + in, - out
  balance_after  numeric(12,3) not null,
  unit_cost      numeric(12,2),
  reference_type text,                          -- transaction | return | purchase | adjustment
  reference_id   uuid,
  reference_no   text,
  notes          text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);
create index if not exists stock_mv_product_idx on public.stock_movements(product_id, created_at desc);
create index if not exists stock_mv_ref_idx on public.stock_movements(reference_id);
create index if not exists stock_mv_date_idx on public.stock_movements(created_at desc);

-- ---------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default '',
  mobile        text,
  address       text not null default '',
  customer_type text not null default 'retail',  -- retail | wholesale | institution | staff
  gstin         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists customers_mobile_uq on public.customers(mobile) where mobile is not null and mobile <> '';

-- ---------------------------------------------------------------------
-- Transactions (master), items, category receipts, payments
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  txn_no           text not null unique,
  txn_seq          bigint not null,
  idempotency_key  uuid not null unique,               -- duplicate-click protection
  customer_id      uuid references public.customers(id),
  customer_name    text not null default '',
  customer_mobile  text not null default '',
  customer_address text not null default '',
  customer_type    text not null default 'retail',
  items_count      int not null default 0,
  gross_amount     numeric(12,2) not null default 0,     -- sum(qty*rate)
  line_discount    numeric(12,2) not null default 0,
  bill_discount    numeric(12,2) not null default 0,
  total_amount     numeric(12,2) not null default 0,     -- payable
  tax_amount       numeric(12,2) not null default 0,     -- GST component (incl. or excl.)
  paid_amount      numeric(12,2) not null default 0,
  outstanding      numeric(12,2) not null default 0,
  refunded_amount  numeric(12,2) not null default 0,
  returned_amount  numeric(12,2) not null default 0,     -- value of goods returned
  payment_mode     text not null default 'cash',         -- summary: cash|upi|card|bank|other|split|credit
  payment_status   text not null default 'paid' check (payment_status in ('paid','partial','unpaid','refunded')),
  status           text not null default 'completed'
                   check (status in ('completed','partially_returned','returned','cancelled')),
  notes            text not null default '',
  created_by       uuid not null references public.users(id),
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.users(id)
);
create index if not exists txn_created_idx on public.transactions(created_at desc);
create index if not exists txn_customer_idx on public.transactions(customer_id);
create index if not exists txn_mobile_idx on public.transactions(customer_mobile);
create index if not exists txn_creator_idx on public.transactions(created_by, created_at desc);

create table if not exists public.category_receipts (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  category_id     uuid not null references public.categories(id) on delete restrict,
  counter_key     text not null,
  receipt_seq     bigint not null,
  receipt_no      text not null,
  category_name_hi text not null,
  category_name_en text not null default '',
  items_count     int not null default 0,
  gross_amount    numeric(12,2) not null default 0,
  line_discount   numeric(12,2) not null default 0,
  bill_discount   numeric(12,2) not null default 0,   -- share of bill-level discount
  total_amount    numeric(12,2) not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  allocated_paid  numeric(12,2) not null default 0,   -- share of the single customer payment
  returned_amount numeric(12,2) not null default 0,
  status          text not null default 'completed'
                  check (status in ('completed','partially_returned','returned','cancelled')),
  pdf_path        text,                               -- Supabase Storage path when archived
  created_at      timestamptz not null default now(),
  unique (transaction_id, category_id),               -- one receipt per category per transaction
  unique (counter_key, receipt_seq),                  -- no duplicate receipt numbers
  unique (id, category_id)                            -- target for composite FK from items
);
create index if not exists receipts_txn_idx on public.category_receipts(transaction_id);
create index if not exists receipts_cat_idx on public.category_receipts(category_id, created_at desc);
create index if not exists receipts_no_idx on public.category_receipts(receipt_no);

create table if not exists public.transaction_items (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  receipt_id      uuid not null,
  category_id     uuid not null references public.categories(id),
  product_id      uuid not null references public.products(id),
  line_no         int not null,
  product_code    text not null,
  product_name_hi text not null,
  product_name_en text not null default '',
  unit            text not null,
  quantity        numeric(12,3) not null check (quantity > 0),
  list_price      numeric(12,2) not null,             -- product master price at billing time
  rate            numeric(12,2) not null check (rate >= 0),  -- price actually charged
  discount        numeric(12,2) not null default 0 check (discount >= 0),
  gst_rate        numeric(5,2) not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  line_total      numeric(12,2) not null,             -- qty*rate - discount
  returned_qty    numeric(12,3) not null default 0,
  created_at      timestamptz not null default now(),
  -- an item can only sit on the receipt of its own category
  foreign key (receipt_id, category_id) references public.category_receipts(id, category_id)
);
create index if not exists titems_txn_idx on public.transaction_items(transaction_id);
create index if not exists titems_receipt_idx on public.transaction_items(receipt_id);
create index if not exists titems_product_idx on public.transaction_items(product_id);

-- receipt_items: read model of the lines on each category receipt.
create or replace view public.receipt_items with (security_invoker = true) as
  select ti.receipt_id, cr.receipt_no, ti.transaction_id, ti.id as transaction_item_id,
         ti.line_no, ti.product_id, ti.product_code, ti.product_name_hi, ti.product_name_en,
         ti.unit, ti.quantity, ti.rate, ti.discount, ti.line_total, ti.returned_qty
    from public.transaction_items ti
    join public.category_receipts cr on cr.id = ti.receipt_id;

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  kind            text not null default 'payment' check (kind in ('payment','refund')),
  mode            text not null check (mode in ('cash','upi','card','bank','other','credit_note')),
  amount          numeric(12,2) not null check (amount > 0),   -- always positive; kind gives sign
  reference       text not null default '',
  return_id       uuid,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists payments_txn_idx on public.payments(transaction_id);
create index if not exists payments_date_idx on public.payments(created_at desc);

-- ---------------------------------------------------------------------
-- Returns & cancellations
-- ---------------------------------------------------------------------
create table if not exists public.returns (
  id              uuid primary key default gen_random_uuid(),
  return_no       text not null unique,
  transaction_id  uuid not null references public.transactions(id) on delete restrict,
  return_type     text not null check (return_type in ('return','cancellation')),
  reason          text not null,
  return_value    numeric(12,2) not null default 0,   -- value of goods reversed (after discounts)
  refund_amount   numeric(12,2) not null default 0,   -- money actually paid back
  refund_mode     text not null default 'cash',
  restock         boolean not null default true,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by    uuid not null references public.users(id),
  requested_at    timestamptz not null default now(),
  approved_by     uuid references public.users(id),
  approved_at     timestamptz,
  decision_note   text not null default ''
);
create index if not exists returns_txn_idx on public.returns(transaction_id);
create index if not exists returns_status_idx on public.returns(status, requested_at desc);

create table if not exists public.return_items (
  id                  uuid primary key default gen_random_uuid(),
  return_id           uuid not null references public.returns(id) on delete restrict,
  transaction_item_id uuid not null references public.transaction_items(id),
  receipt_id          uuid not null references public.category_receipts(id),
  product_id          uuid not null references public.products(id),
  quantity            numeric(12,3) not null check (quantity > 0),
  amount              numeric(12,2) not null default 0
);
create index if not exists return_items_return_idx on public.return_items(return_id);

-- ---------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null,          -- INSERT | UPDATE | DELETE | BILL | CANCEL | ...
  old_data    jsonb,
  new_data    jsonb,
  user_id     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_table_idx on public.audit_logs(table_name, record_id);

-- Uniqueness helper for number series of returns / txns
create sequence if not exists public.txn_seq;
create sequence if not exists public.return_seq;
