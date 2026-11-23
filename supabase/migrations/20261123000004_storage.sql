-- =====================================================================
-- Supabase Storage buckets (invoices + shop assets) — Supabase only
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false), ('shop-assets', 'shop-assets', true)
on conflict (id) do nothing;

drop policy if exists "receipts staff read" on storage.objects;
create policy "receipts staff read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_staff());
drop policy if exists "receipts staff upload" on storage.objects;
create policy "receipts staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_staff());

drop policy if exists "assets public read" on storage.objects;
create policy "assets public read" on storage.objects for select
  using (bucket_id = 'shop-assets');
drop policy if exists "assets admin write" on storage.objects;
create policy "assets admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-assets' and (public.is_admin() or public.has_role('employee')));
drop policy if exists "assets admin update" on storage.objects;
create policy "assets admin update" on storage.objects for update to authenticated
  using (bucket_id = 'shop-assets' and public.is_admin());
