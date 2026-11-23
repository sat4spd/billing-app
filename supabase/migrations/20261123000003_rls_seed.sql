-- =====================================================================
-- Row Level Security, grants and seed data
-- Clients never write sales/stock tables directly: all writes go through
-- SECURITY DEFINER functions which check the caller's role.
-- =====================================================================

alter table public.roles             enable row level security;
alter table public.users             enable row level security;
alter table public.shop_settings     enable row level security;
alter table public.categories        enable row level security;
alter table public.receipt_counters  enable row level security;
alter table public.products          enable row level security;
alter table public.product_costs     enable row level security;
alter table public.inventory         enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.customers         enable row level security;
alter table public.transactions      enable row level security;
alter table public.transaction_items enable row level security;
alter table public.category_receipts enable row level security;
alter table public.payments          enable row level security;
alter table public.returns           enable row level security;
alter table public.return_items      enable row level security;
alter table public.audit_logs        enable row level security;

-- helper: any active staff member
create or replace function public.is_staff() returns boolean language sql stable as $$
  select public.current_role_code() is not null $$;

-- roles
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using (true);

-- users
drop policy if exists users_read on public.users;
create policy users_read on public.users for select to authenticated
  using (id = auth.uid() or public.is_staff());
drop policy if exists users_admin_write on public.users;
create policy users_admin_write on public.users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- shop settings: readable by anyone (login screen shows shop name), editable by admin
drop policy if exists settings_read on public.shop_settings;
create policy settings_read on public.shop_settings for select to anon, authenticated using (true);
drop policy if exists settings_write on public.shop_settings;
create policy settings_write on public.shop_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- categories
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated using (public.is_staff());
drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated with check (public.is_admin());
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- receipt counters (admin may view / reset numbering)
drop policy if exists counters_read on public.receipt_counters;
create policy counters_read on public.receipt_counters for select to authenticated using (public.has_role('admin','accountant'));
drop policy if exists counters_write on public.receipt_counters;
create policy counters_write on public.receipt_counters for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists counters_insert on public.receipt_counters;
create policy counters_insert on public.receipt_counters for insert to authenticated with check (public.is_admin());

-- products (writes through save_product)
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (public.is_staff());
drop policy if exists products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- purchase price: admin / accountant only
drop policy if exists costs_read on public.product_costs;
create policy costs_read on public.product_costs for select to authenticated using (public.has_role('admin','accountant'));
drop policy if exists costs_write on public.product_costs;
create policy costs_write on public.product_costs for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- inventory & movements (read only for clients)
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated using (public.is_staff());
drop policy if exists movements_read on public.stock_movements;
create policy movements_read on public.stock_movements for select to authenticated
  using (public.has_role('admin','accountant'));

-- customers
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated using (public.is_staff());
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated with check (public.is_staff());
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- sales (read only; visibility via can_view_txn)
drop policy if exists txn_read on public.transactions;
create policy txn_read on public.transactions for select to authenticated
  using (public.can_view_txn(created_by, created_at));
drop policy if exists receipts_read on public.category_receipts;
create policy receipts_read on public.category_receipts for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and public.can_view_txn(t.created_by, t.created_at)));
drop policy if exists receipts_pdf_update on public.category_receipts;
drop policy if exists titems_read on public.transaction_items;
create policy titems_read on public.transaction_items for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and public.can_view_txn(t.created_by, t.created_at)));
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and public.can_view_txn(t.created_by, t.created_at)));

-- returns
drop policy if exists returns_read on public.returns;
create policy returns_read on public.returns for select to authenticated
  using (public.has_role('admin','accountant') or requested_by = auth.uid());
drop policy if exists return_items_read on public.return_items;
create policy return_items_read on public.return_items for select to authenticated
  using (exists (select 1 from public.returns r where r.id = return_id
                 and (public.has_role('admin','accountant') or r.requested_by = auth.uid())));

-- audit
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (public.is_admin());

-- Record archived PDF path for a receipt (any staff who can see it).
create or replace function public.set_receipt_pdf(p_receipt uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.category_receipts cr join public.transactions t on t.id = cr.transaction_id
                  where cr.id = p_receipt and public.can_view_txn(t.created_by, t.created_at)) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  update public.category_receipts set pdf_path = left(p_path, 300) where id = p_receipt;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.shop_settings to anon;
grant select on all tables in schema public to authenticated;
grant update on public.users, public.shop_settings, public.categories, public.receipt_counters,
                public.products, public.product_costs, public.customers to authenticated;
grant insert on public.categories, public.receipt_counters, public.customers to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- internal helpers should not be called directly by clients
revoke execute on function public.next_counter(text, bigint) from authenticated;
revoke execute on function public.handle_new_auth_user() from authenticated;

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------
insert into public.roles(code, name_hi, name_en, permissions) values
  ('admin',      'प्रशासक',          'Administrator',     '{"all":true}'),
  ('employee',   'बिलिंग कर्मचारी',   'Billing Employee',  '{"billing":true}'),
  ('accountant', 'लेखाकार / प्रबंधक', 'Accountant / Manager', '{"reports":true,"registers":true}')
on conflict (code) do nothing;

insert into public.shop_settings(id) values (1) on conflict (id) do nothing;

insert into public.categories(code, name_hi, name_en, receipt_prefix, color, sort_order) values
  ('woollen',     'ऊनी',              'Woollen',                     'ऊ-',  '#b45309', 1),
  ('silk',        'रेशम',             'Silk',                        'रे-', '#be185d', 2),
  ('cotton',      'सूती',             'Cotton',                      'सू-', '#0369a1', 3),
  ('khadi',       'खादी',             'Khadi',                       'खा-', '#15803d', 4),
  ('handicrafts', 'हस्तशिल्प',         'Handicrafts',                 'ह-',  '#7c3aed', 5),
  ('village',     'ग्रामोद्योग उत्पाद', 'Village Industries Products', 'ग्रा-', '#a16207', 6),
  ('other',       'अन्य',             'Other Products',              'अ-',  '#475569', 7)
on conflict (code) do nothing;
