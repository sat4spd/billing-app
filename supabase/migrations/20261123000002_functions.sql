-- =====================================================================
-- Helper functions, triggers and business logic (RPCs)
-- All money-moving logic runs inside single PostgreSQL functions so that
-- receipt generation, payment recording and stock deduction are atomic.
-- =====================================================================

create or replace function public.app_tz() returns text language sql immutable as $$ select 'Asia/Kolkata' $$;

-- ---------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------
create or replace function public.current_role_code() returns text
language sql stable security definer set search_path = public as $$
  select role_code from public.users where id = auth.uid() and is_active
$$;

create or replace function public.has_role(variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role_code = any(p_roles) from public.users where id = auth.uid() and is_active), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.has_role('admin') $$;

-- perm: 'edit_price' | 'discount'
create or replace function public.has_perm(p_perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare u public.users; s public.shop_settings;
begin
  select * into u from public.users where id = auth.uid() and is_active;
  if not found then return false; end if;
  if u.role_code = 'admin' then return true; end if;
  select * into s from public.shop_settings where id = 1;
  if p_perm = 'edit_price' then return coalesce(s.employee_can_edit_price,false) or u.can_edit_price; end if;
  if p_perm = 'discount'   then return coalesce(s.employee_can_give_discount,false) or u.can_give_discount; end if;
  return false;
end $$;

create or replace function public.require_role(variadic p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.has_role(variadic p_roles) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Employees see their own bills and today's bills; admin/accountant see everything.
create or replace function public.can_view_txn(p_created_by uuid, p_created_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.has_role('admin','accountant') then true
    when public.has_role('employee') then p_created_by = auth.uid()
         or (p_created_at at time zone public.app_tz())::date = (now() at time zone public.app_tz())::date
    else false end
$$;

-- ---------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.tg_block_delete() returns trigger language plpgsql as $$
begin
  raise exception 'DELETE_NOT_ALLOWED: records in % are permanent; use cancellation/reversal', tg_table_name
    using errcode = '42501';
end $$;

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  rid := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end,
    case when tg_op = 'DELETE' then to_jsonb(old)->>'product_id' else to_jsonb(new)->>'product_id' end);
  insert into public.audit_logs(table_name, record_id, action, old_data, new_data, user_id)
  values (tg_table_name, rid, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

-- updated_at
do $$ declare t text; begin
  foreach t in array array['users','categories','products','customers','shop_settings','product_costs'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.tg_touch_updated_at()', t);
  end loop;
end $$;

-- permanent records
do $$ declare t text; begin
  foreach t in array array['transactions','transaction_items','category_receipts','payments',
                           'stock_movements','returns','return_items','audit_logs'] loop
    execute format('drop trigger if exists trg_no_delete on public.%I', t);
    execute format('create trigger trg_no_delete before delete on public.%I for each row execute function public.tg_block_delete()', t);
  end loop;
end $$;

-- audit trail for master data
do $$ declare t text; begin
  foreach t in array array['users','categories','products','product_costs','shop_settings','receipt_counters'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- Every product gets an inventory row.
create or replace function public.tg_product_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory(product_id) values (new.id) on conflict do nothing;
  insert into public.product_costs(product_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_product_inventory on public.products;
create trigger trg_product_inventory after insert on public.products
  for each row execute function public.tg_product_inventory();

-- New auth user -> public.users. The very first user becomes admin.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text; v_first boolean;
begin
  select not exists(select 1 from public.users) into v_first;
  v_role := case when v_first then 'admin'
                 else coalesce(nullif(new.raw_user_meta_data->>'role_code',''), 'employee') end;
  if v_role not in (select code from public.roles) then v_role := 'employee'; end if;
  insert into public.users(id, full_name, email, role_code, is_active)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1)),
          new.email, v_role,
          -- self sign-ups (not created by an admin) stay inactive until an admin activates them
          v_first or coalesce((new.raw_user_meta_data->>'created_by_admin')::boolean, false))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Prevent an admin from locking everybody out.
create or replace function public.tg_users_guard() returns trigger language plpgsql as $$
begin
  if old.role_code = 'admin' and (new.role_code <> 'admin' or not new.is_active) then
    if not exists (select 1 from public.users where role_code = 'admin' and is_active and id <> old.id) then
      raise exception 'LAST_ADMIN: at least one active administrator is required';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_users_guard on public.users;
create trigger trg_users_guard before update on public.users for each row execute function public.tg_users_guard();

-- ---------------------------------------------------------------------
-- Numbering
-- ---------------------------------------------------------------------
create or replace function public.next_counter(p_key text, p_start bigint default 1) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.receipt_counters(counter_key, last_no) values (p_key, greatest(p_start,1))
  on conflict (counter_key) do update
     set last_no = greatest(public.receipt_counters.last_no + 1, greatest(p_start,1)),
         updated_at = now()
  returning last_no into v;
  return v;
end $$;

-- Largest-remainder allocation of an amount (in paise) over weights.
create or replace function public.allocate_amount(p_total numeric, p_weights numeric[]) returns numeric[]
language plpgsql immutable as $$
declare
  n int := coalesce(array_length(p_weights,1),0);
  wsum numeric := 0; tot bigint := round(coalesce(p_total,0)*100)::bigint;
  res bigint[] := '{}'; rems numeric[] := '{}'; assigned bigint := 0; ex numeric; i int; r record;
  outv numeric[] := '{}';
begin
  if n = 0 then return outv; end if;
  for i in 1..n loop wsum := wsum + greatest(coalesce(p_weights[i],0),0); end loop;
  for i in 1..n loop
    if wsum = 0 then ex := case when i = 1 then tot else 0 end;
    else ex := tot * greatest(coalesce(p_weights[i],0),0) / wsum; end if;
    res := res || floor(ex)::bigint; rems := rems || (ex - floor(ex)); assigned := assigned + floor(ex)::bigint;
  end loop;
  for r in select ord::int as k from unnest(rems) with ordinality t(v, ord) order by v desc, ord
           limit greatest(tot - assigned, 0) loop
    res[r.k] := res[r.k] + 1;
  end loop;
  for i in 1..n loop outv := outv || (res[i]::numeric / 100); end loop;
  return outv;
end $$;

-- ---------------------------------------------------------------------
-- CREATE BILL  — the heart of the system
-- payload:
-- { "idempotency_key": uuid,
--   "customer": {"name","mobile","address","type"},
--   "items": [{"product_id","quantity","rate"?, "discount"?}],
--   "bill_discount": number,
--   "payments": [{"mode","amount","reference"}],
--   "allocation": [{"category_id","amount"}]   -- optional manual split
--   "allow_negative_stock": bool               -- admin-only override
--   "notes": text }
-- returns {"id","txn_no","duplicate"}
-- ---------------------------------------------------------------------
create or replace function public.create_bill(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_key uuid; v_existing public.transactions;
  s public.shop_settings; v_is_admin boolean; v_can_price boolean; v_can_disc boolean;
  it record; prod record; v_lines jsonb := '[]'::jsonb; v_line_no int := 0;
  v_qty numeric; v_rate numeric; v_disc numeric; v_base numeric; v_tax numeric; v_total_line numeric;
  v_cat_ids uuid[]; v_cat_net numeric[]; v_cat_bd numeric[]; v_cat_tot numeric[]; v_cat_alloc numeric[];
  v_gross numeric := 0; v_ldisc numeric := 0; v_net numeric := 0; v_bdisc numeric; v_total numeric; v_taxsum numeric := 0;
  v_paid numeric := 0; v_modes text[]; v_mode text; v_pstatus text;
  v_cust_id uuid; v_cname text; v_cmobile text; v_caddr text; v_ctype text;
  v_txn_id uuid := gen_random_uuid(); v_txn_seq bigint; v_txn_no text;
  c record; v_key_txt text; v_seq bigint; i int; v_rid uuid; v_alloc_sum numeric;
  pay record; v_override boolean; mv record; v_new_qty numeric;
begin
  v_uid := public.require_role('admin','employee');
  v_key := nullif(p->>'idempotency_key','')::uuid;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  -- Serialise concurrent submissions of the same cart (double click / retry).
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  select * into v_existing from public.transactions where idempotency_key = v_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'txn_no', v_existing.txn_no, 'duplicate', true);
  end if;

  select * into s from public.shop_settings where id = 1;
  v_is_admin := public.is_admin();
  v_can_price := public.has_perm('edit_price');
  v_can_disc  := public.has_perm('discount');
  v_override  := coalesce((p->>'allow_negative_stock')::boolean, false) and v_is_admin;

  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'EMPTY_CART: बिल में कोई सामान नहीं है';
  end if;
  if jsonb_array_length(p->'items') > 500 then raise exception 'TOO_MANY_ITEMS'; end if;

  -- Lock inventory rows in a stable order to avoid deadlocks.
  perform 1 from public.inventory
   where product_id in (select (e->>'product_id')::uuid from jsonb_array_elements(p->'items') e)
   order by product_id for update;

  -- Build validated lines (prices always come from the DB unless permitted).
  for it in select e, ord from jsonb_array_elements(p->'items') with ordinality t(e, ord) loop
    select pr.*, c2.name_hi as cat_name_hi, c2.sort_order as cat_sort, c2.is_active as cat_active
      into prod
      from public.products pr join public.categories c2 on c2.id = pr.category_id
     where pr.id = (it.e->>'product_id')::uuid;
    if not found then raise exception 'PRODUCT_NOT_FOUND: %', it.e->>'product_id'; end if;
    if not prod.is_active then raise exception 'PRODUCT_INACTIVE: %', prod.name_hi; end if;

    v_qty := round(coalesce((it.e->>'quantity')::numeric, 0), 3);
    if v_qty <= 0 then raise exception 'INVALID_QUANTITY: %', prod.name_hi; end if;

    v_rate := coalesce(round((it.e->>'rate')::numeric, 2), prod.selling_price);
    if v_rate < 0 then raise exception 'INVALID_RATE: %', prod.name_hi; end if;
    if v_rate <> prod.selling_price and not v_can_price then
      raise exception 'PRICE_EDIT_NOT_ALLOWED: %', prod.name_hi using errcode = '42501';
    end if;

    v_disc := round(coalesce((it.e->>'discount')::numeric, 0), 2);
    if v_disc < 0 then raise exception 'INVALID_DISCOUNT'; end if;
    if v_disc > 0 and not v_can_disc then raise exception 'DISCOUNT_NOT_ALLOWED' using errcode = '42501'; end if;
    v_base := round(v_qty * v_rate, 2);
    if v_disc > v_base then raise exception 'DISCOUNT_EXCEEDS_AMOUNT: %', prod.name_hi; end if;
    if v_disc > 0 and not v_is_admin and v_disc > round(v_base * s.max_discount_percent / 100, 2) then
      raise exception 'DISCOUNT_LIMIT: max % %%', s.max_discount_percent using errcode = '42501';
    end if;

    if s.prices_include_gst then
      v_total_line := v_base - v_disc;
      v_tax := round(v_total_line * prod.gst_rate / (100 + prod.gst_rate), 2);
    else
      v_tax := round((v_base - v_disc) * prod.gst_rate / 100, 2);
      v_total_line := v_base - v_disc + v_tax;
    end if;

    v_line_no := v_line_no + 1;
    v_lines := v_lines || jsonb_build_object(
      'line_no', v_line_no, 'product_id', prod.id, 'category_id', prod.category_id,
      'cat_sort', prod.cat_sort, 'product_code', prod.product_code, 'name_hi', prod.name_hi,
      'name_en', prod.name_en, 'unit', prod.unit, 'qty', v_qty, 'list_price', prod.selling_price,
      'rate', v_rate, 'discount', v_disc, 'gst_rate', prod.gst_rate, 'tax', v_tax,
      'gross', v_base, 'line_total', v_total_line);
    v_gross := v_gross + v_base; v_ldisc := v_ldisc + v_disc; v_net := v_net + v_total_line; v_taxsum := v_taxsum + v_tax;
  end loop;

  -- Stock validation (aggregate per product).
  for mv in
    select (l->>'product_id')::uuid pid, max(l->>'name_hi') nm, sum((l->>'qty')::numeric) q
      from jsonb_array_elements(v_lines) l group by 1
  loop
    if (select quantity from public.inventory where product_id = mv.pid) < mv.q
       and not s.allow_negative_stock and not v_override then
      raise exception 'INSUFFICIENT_STOCK: % (उपलब्ध %)', mv.nm,
        (select quantity from public.inventory where product_id = mv.pid);
    end if;
  end loop;

  -- Group by category (ordered by category sort order).
  select array_agg(cid order by srt, cid), array_agg(net order by srt, cid)
    into v_cat_ids, v_cat_net
    from (select (l->>'category_id')::uuid cid, min((l->>'cat_sort')::int) srt,
                 sum((l->>'line_total')::numeric) net
            from jsonb_array_elements(v_lines) l group by 1) g;

  -- Bill-level discount, split proportionally over category receipts.
  v_bdisc := round(coalesce((p->>'bill_discount')::numeric, 0), 2);
  if v_bdisc < 0 or v_bdisc > v_net then raise exception 'INVALID_BILL_DISCOUNT'; end if;
  if v_bdisc > 0 and not v_can_disc then raise exception 'DISCOUNT_NOT_ALLOWED' using errcode = '42501'; end if;
  if v_bdisc > 0 and not v_is_admin and v_bdisc > round(v_net * s.max_discount_percent / 100, 2) then
    raise exception 'DISCOUNT_LIMIT: max % %%', s.max_discount_percent using errcode = '42501';
  end if;
  v_cat_bd := public.allocate_amount(v_bdisc, v_cat_net);
  v_cat_tot := '{}';
  for i in 1..array_length(v_cat_ids,1) loop v_cat_tot := v_cat_tot || (v_cat_net[i] - v_cat_bd[i]); end loop;
  v_total := v_net - v_bdisc;

  -- Payments (recorded once per master transaction).
  if p ? 'payments' and jsonb_typeof(p->'payments') = 'array' then
    for pay in select e from jsonb_array_elements(p->'payments') e loop
      if coalesce((pay.e->>'amount')::numeric,0) < 0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
      if (pay.e->>'mode') not in ('cash','upi','card','bank','other') then
        raise exception 'INVALID_PAYMENT_MODE: %', pay.e->>'mode';
      end if;
      v_paid := v_paid + round(coalesce((pay.e->>'amount')::numeric,0), 2);
    end loop;
    select array_agg(distinct e->>'mode') into v_modes
      from jsonb_array_elements(p->'payments') e where coalesce((e->>'amount')::numeric,0) > 0;
  end if;
  if v_paid > v_total then raise exception 'OVERPAYMENT: भुगतान कुल राशि से अधिक है (%>%)', v_paid, v_total; end if;
  v_mode := case when v_modes is null or array_length(v_modes,1) is null then 'credit'
                 when array_length(v_modes,1) = 1 then v_modes[1] else 'split' end;
  v_pstatus := case when v_paid >= v_total then 'paid' when v_paid > 0 then 'partial' else 'unpaid' end;

  -- Customer
  v_cname   := left(trim(coalesce(p->'customer'->>'name','')), 120);
  v_cmobile := regexp_replace(coalesce(p->'customer'->>'mobile',''), '[^0-9+]', '', 'g');
  v_caddr   := left(trim(coalesce(p->'customer'->>'address','')), 300);
  v_ctype   := coalesce(nullif(p->'customer'->>'type',''), 'retail');
  if v_cmobile <> '' and length(regexp_replace(v_cmobile,'\D','','g')) not between 10 and 13 then
    raise exception 'INVALID_MOBILE';
  end if;
  if v_pstatus <> 'paid' and v_cname = '' and v_cmobile = '' then
    raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT: उधार बिक्री के लिए ग्राहक का नाम/मोबाइल आवश्यक है';
  end if;
  if v_cmobile <> '' then
    insert into public.customers(name, mobile, address, customer_type)
    values (v_cname, v_cmobile, v_caddr, v_ctype)
    on conflict (mobile) where mobile is not null and mobile <> '' do update
      set name = case when excluded.name <> '' then excluded.name else public.customers.name end,
          address = case when excluded.address <> '' then excluded.address else public.customers.address end,
          customer_type = excluded.customer_type
    returning id into v_cust_id;
  end if;

  -- Master transaction
  v_txn_seq := public.next_counter('txn', 1);
  v_txn_no := s.txn_prefix || lpad(v_txn_seq::text, 6, '0');
  insert into public.transactions(id, txn_no, txn_seq, idempotency_key, customer_id, customer_name,
      customer_mobile, customer_address, customer_type, items_count, gross_amount, line_discount,
      bill_discount, total_amount, tax_amount, paid_amount, outstanding, payment_mode, payment_status,
      notes, created_by)
  values (v_txn_id, v_txn_no, v_txn_seq, v_key, v_cust_id, v_cname, v_cmobile, v_caddr, v_ctype,
      v_line_no, v_gross, v_ldisc, v_bdisc, v_total, v_taxsum, v_paid, v_total - v_paid, v_mode, v_pstatus,
      left(coalesce(p->>'notes',''), 500), v_uid);

  -- Payment allocation across receipts
  if p ? 'allocation' and jsonb_typeof(p->'allocation') = 'array' and jsonb_array_length(p->'allocation') > 0 then
    v_cat_alloc := '{}'; v_alloc_sum := 0;
    for i in 1..array_length(v_cat_ids,1) loop
      v_cat_alloc := v_cat_alloc || coalesce((select round((e->>'amount')::numeric,2)
                         from jsonb_array_elements(p->'allocation') e
                        where (e->>'category_id')::uuid = v_cat_ids[i] limit 1), 0);
      if v_cat_alloc[i] < 0 or v_cat_alloc[i] > v_cat_tot[i] then raise exception 'INVALID_ALLOCATION'; end if;
      v_alloc_sum := v_alloc_sum + v_cat_alloc[i];
    end loop;
    if v_alloc_sum <> v_paid then raise exception 'ALLOCATION_MISMATCH: % <> %', v_alloc_sum, v_paid; end if;
  else
    v_cat_alloc := public.allocate_amount(v_paid, v_cat_tot);
  end if;

  -- One receipt per category, each with its own number series.
  for i in 1..array_length(v_cat_ids,1) loop
    select * into c from public.categories where id = v_cat_ids[i];
    if s.receipt_numbering_mode = 'global' then
      v_key_txt := 'global'; v_seq := public.next_counter('global', 1);
    else
      v_key_txt := c.id::text; v_seq := public.next_counter(c.id::text, c.receipt_start_no);
    end if;
    insert into public.category_receipts(transaction_id, category_id, counter_key, receipt_seq, receipt_no,
        category_name_hi, category_name_en, items_count, gross_amount, line_discount, bill_discount,
        total_amount, tax_amount, allocated_paid)
    select v_txn_id, c.id, v_key_txt, v_seq, c.receipt_prefix || v_seq::text, c.name_hi, c.name_en,
           count(*), sum((l->>'gross')::numeric), sum((l->>'discount')::numeric), v_cat_bd[i],
           v_cat_tot[i], sum((l->>'tax')::numeric), v_cat_alloc[i]
      from jsonb_array_elements(v_lines) l where (l->>'category_id')::uuid = c.id;
  end loop;

  -- Items
  insert into public.transaction_items(transaction_id, receipt_id, category_id, product_id, line_no,
      product_code, product_name_hi, product_name_en, unit, quantity, list_price, rate, discount,
      gst_rate, tax_amount, line_total)
  select v_txn_id, cr.id, cr.category_id, (l->>'product_id')::uuid, (l->>'line_no')::int,
         l->>'product_code', l->>'name_hi', coalesce(l->>'name_en',''), l->>'unit', (l->>'qty')::numeric,
         (l->>'list_price')::numeric, (l->>'rate')::numeric, (l->>'discount')::numeric,
         (l->>'gst_rate')::numeric, (l->>'tax')::numeric, (l->>'line_total')::numeric
    from jsonb_array_elements(v_lines) l
    join public.category_receipts cr on cr.transaction_id = v_txn_id and cr.category_id = (l->>'category_id')::uuid;

  -- Stock deduction + traceable movements
  for mv in select (l->>'product_id')::uuid pid, sum((l->>'qty')::numeric) q
              from jsonb_array_elements(v_lines) l group by 1 order by 1 loop
    update public.inventory set quantity = quantity - mv.q, updated_at = now()
     where product_id = mv.pid returning quantity into v_new_qty;
    insert into public.stock_movements(product_id, movement_type, quantity, balance_after,
        reference_type, reference_id, reference_no, created_by)
    values (mv.pid, 'sale', -mv.q, v_new_qty, 'transaction', v_txn_id, v_txn_no, v_uid);
  end loop;

  -- Payment rows
  if p ? 'payments' and jsonb_typeof(p->'payments') = 'array' then
    insert into public.payments(transaction_id, kind, mode, amount, reference, created_by)
    select v_txn_id, 'payment', e->>'mode', round((e->>'amount')::numeric,2),
           left(coalesce(e->>'reference',''), 120), v_uid
      from jsonb_array_elements(p->'payments') e
     where coalesce((e->>'amount')::numeric,0) > 0;
  end if;

  insert into public.audit_logs(table_name, record_id, action, new_data, user_id)
  values ('transactions', v_txn_id::text, 'BILL',
          jsonb_build_object('txn_no', v_txn_no, 'total', v_total, 'paid', v_paid,
                             'receipts', array_length(v_cat_ids,1)), v_uid);

  return jsonb_build_object('id', v_txn_id, 'txn_no', v_txn_no, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------------
-- Full transaction detail (security invoker: RLS decides visibility)
-- ---------------------------------------------------------------------
create or replace function public.get_transaction_detail(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'transaction', to_jsonb(t) || jsonb_build_object('employee_name', u.full_name),
    'receipts', coalesce((
       select jsonb_agg(to_jsonb(cr) || jsonb_build_object('items', coalesce((
                 select jsonb_agg(to_jsonb(ti) order by ti.line_no)
                   from public.transaction_items ti where ti.receipt_id = cr.id), '[]'::jsonb))
              order by cat.sort_order, cr.receipt_no)
         from public.category_receipts cr join public.categories cat on cat.id = cr.category_id
        where cr.transaction_id = t.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(pm) order by pm.created_at)
                            from public.payments pm where pm.transaction_id = t.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('items', coalesce((
                   select jsonb_agg(to_jsonb(ri)) from public.return_items ri where ri.return_id = r.id),'[]'::jsonb))
                   order by r.requested_at)
                 from public.returns r where r.transaction_id = t.id), '[]'::jsonb))
  from public.transactions t
  left join public.users u on u.id = t.created_by
  where t.id = p_id
$$;

-- ---------------------------------------------------------------------
-- RETURNS & CANCELLATIONS
-- ---------------------------------------------------------------------
-- Net value (after bill-discount share) of qty units of a transaction item.
create or replace function public.item_unit_net(p_item_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when ti.quantity = 0 then 0 else
           (ti.line_total - case when cr.gross_amount - cr.line_discount = 0 then 0
              else cr.bill_discount * ti.line_total / nullif((select sum(line_total) from public.transaction_items x where x.receipt_id = cr.id),0) end
           ) / ti.quantity end
    from public.transaction_items ti join public.category_receipts cr on cr.id = ti.receipt_id
   where ti.id = p_item_id
$$;

-- payload: {"transaction_id","type":"return|cancellation","reason","refund_mode","restock",
--           "items":[{"transaction_item_id","quantity"}], "auto_approve": bool}
create or replace function public.request_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; t public.transactions; v_type text; v_reason text; v_ret_id uuid := gen_random_uuid();
  v_no text; it record; ti public.transaction_items; v_pending numeric; v_amount numeric := 0; v_line numeric;
  v_refund numeric; v_count int := 0;
begin
  v_uid := public.require_role('admin','employee','accountant');
  v_type := coalesce(p->>'type','return');
  if v_type not in ('return','cancellation') then raise exception 'INVALID_TYPE'; end if;
  v_reason := trim(coalesce(p->>'reason',''));
  if v_reason = '' then raise exception 'REASON_REQUIRED: कारण लिखना आवश्यक है'; end if;

  select * into t from public.transactions where id = (p->>'transaction_id')::uuid for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if not public.has_role('admin','accountant') and t.created_by <> v_uid
     and (t.created_at at time zone public.app_tz())::date <> (now() at time zone public.app_tz())::date then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if t.status in ('cancelled','returned') then raise exception 'ALREADY_REVERSED: बिल पहले ही रद्द/वापस हो चुका है'; end if;
  if exists (select 1 from public.returns where transaction_id = t.id and status = 'pending' and return_type = 'cancellation') then
    raise exception 'CANCELLATION_PENDING';
  end if;
  if v_type = 'cancellation' and exists (select 1 from public.returns where transaction_id = t.id and status = 'pending') then
    raise exception 'RETURN_PENDING: पहले लंबित वापसी अनुरोध निपटाएं';
  end if;

  v_no := 'RET' || lpad(public.next_counter('return', 1)::text, 6, '0');
  insert into public.returns(id, return_no, transaction_id, return_type, reason, refund_mode, restock, requested_by)
  values (v_ret_id, v_no, t.id, v_type, left(v_reason, 500),
          coalesce(nullif(p->>'refund_mode',''), 'cash'), coalesce((p->>'restock')::boolean, true), v_uid);

  if v_type = 'cancellation' then
    for ti in select * from public.transaction_items where transaction_id = t.id and quantity > returned_qty loop
      v_line := round(public.item_unit_net(ti.id) * (ti.quantity - ti.returned_qty), 2);
      insert into public.return_items(return_id, transaction_item_id, receipt_id, product_id, quantity, amount)
      values (v_ret_id, ti.id, ti.receipt_id, ti.product_id, ti.quantity - ti.returned_qty, v_line);
      v_amount := v_amount + v_line; v_count := v_count + 1;
    end loop;
    -- push the paise rounding residual onto one line so item amounts sum to the exact remaining value
    if v_count > 0 and v_amount <> t.total_amount - t.returned_amount then
      update public.return_items set amount = amount + ((t.total_amount - t.returned_amount) - v_amount)
       where id = (select id from public.return_items where return_id = v_ret_id order by amount desc limit 1);
    end if;
    v_amount := t.total_amount - t.returned_amount;
  else
    for it in select (e->>'transaction_item_id')::uuid iid, round((e->>'quantity')::numeric,3) q
                from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) e loop
      if it.q is null or it.q <= 0 then continue; end if;
      select * into ti from public.transaction_items where id = it.iid and transaction_id = t.id;
      if not found then raise exception 'ITEM_NOT_IN_TRANSACTION'; end if;
      select coalesce(sum(ri.quantity),0) into v_pending
        from public.return_items ri join public.returns r on r.id = ri.return_id
       where ri.transaction_item_id = ti.id and r.status = 'pending';
      if it.q > ti.quantity - ti.returned_qty - v_pending then
        raise exception 'RETURN_QTY_EXCEEDS: %', ti.product_name_hi;
      end if;
      v_line := round(public.item_unit_net(ti.id) * it.q, 2);
      insert into public.return_items(return_id, transaction_item_id, receipt_id, product_id, quantity, amount)
      values (v_ret_id, ti.id, ti.receipt_id, ti.product_id, it.q, v_line);
      v_amount := v_amount + v_line; v_count := v_count + 1;
    end loop;
  end if;
  if v_count = 0 then raise exception 'NO_ITEMS_TO_RETURN'; end if;

  v_amount := least(v_amount, t.total_amount - t.returned_amount);
  -- money actually refunded can never exceed what the customer paid (net of earlier refunds)
  v_refund := least(v_amount, t.paid_amount - t.refunded_amount);
  update public.returns set refund_amount = greatest(v_refund,0), return_value = v_amount where id = v_ret_id;

  insert into public.audit_logs(table_name, record_id, action, new_data, user_id)
  values ('returns', v_ret_id::text, 'REQUEST_' || upper(v_type),
          jsonb_build_object('return_no', v_no, 'txn_no', t.txn_no, 'value', v_amount), v_uid);

  if coalesce((p->>'auto_approve')::boolean, false) and public.is_admin() then
    perform public.approve_return(v_ret_id, 'स्वतः स्वीकृत (प्रशासक)');
  end if;
  return jsonb_build_object('id', v_ret_id, 'return_no', v_no, 'value', v_amount, 'refund', v_refund);
end $$;

create or replace function public.approve_return(p_return_id uuid, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; r public.returns; t public.transactions; ri record; v_value numeric := 0; v_new_qty numeric;
  v_refund numeric; v_out_reduce numeric; v_all_returned boolean;
begin
  v_uid := public.require_role('admin');
  select * into r from public.returns where id = p_return_id for update;
  if not found then raise exception 'RETURN_NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  select * into t from public.transactions where id = r.transaction_id for update;
  if t.status in ('cancelled','returned') then raise exception 'ALREADY_REVERSED'; end if;

  perform 1 from public.inventory where product_id in (select product_id from public.return_items where return_id = r.id)
   order by product_id for update;

  for ri in select x.*, ti.quantity as sold_qty, ti.returned_qty
              from public.return_items x join public.transaction_items ti on ti.id = x.transaction_item_id
             where x.return_id = r.id loop
    if ri.quantity > ri.sold_qty - ri.returned_qty then raise exception 'RETURN_QTY_EXCEEDS'; end if;
    update public.transaction_items set returned_qty = returned_qty + ri.quantity where id = ri.transaction_item_id;
    update public.category_receipts set returned_amount = returned_amount + ri.amount where id = ri.receipt_id;
    v_value := v_value + ri.amount;
    if r.restock then
      update public.inventory set quantity = quantity + ri.quantity, updated_at = now()
       where product_id = ri.product_id returning quantity into v_new_qty;
      insert into public.stock_movements(product_id, movement_type, quantity, balance_after, reference_type,
                                         reference_id, reference_no, notes, created_by)
      values (ri.product_id, case when r.return_type = 'cancellation' then 'sale_cancel' else 'return' end::public.movement_type,
              ri.quantity, v_new_qty, 'return', r.id, r.return_no || ' / ' || t.txn_no, r.reason, v_uid);
    end if;
  end loop;

  if r.return_type = 'cancellation' then v_value := t.total_amount - t.returned_amount; end if;
  v_value := least(v_value, t.total_amount - t.returned_amount);
  v_refund := least(r.refund_amount, t.paid_amount - t.refunded_amount);
  v_out_reduce := least(t.outstanding, v_value - v_refund);

  -- fix receipt statuses
  update public.category_receipts cr set status = case
      when not exists (select 1 from public.transaction_items x where x.receipt_id = cr.id and x.quantity > x.returned_qty)
        then case when r.return_type = 'cancellation' then 'cancelled' else 'returned' end
      when cr.returned_amount > 0 then 'partially_returned' else cr.status end
   where cr.transaction_id = t.id;

  select not exists (select 1 from public.transaction_items x where x.transaction_id = t.id and x.quantity > x.returned_qty)
    into v_all_returned;

  update public.transactions set
      returned_amount = returned_amount + v_value,
      refunded_amount = refunded_amount + v_refund,
      outstanding     = greatest(outstanding - v_out_reduce, 0),
      status = case when r.return_type = 'cancellation' then 'cancelled'
                    when v_all_returned then 'returned' else 'partially_returned' end,
      payment_status = case when (paid_amount - refunded_amount - v_refund) <= 0 and paid_amount > 0 then 'refunded'
                            else payment_status end,
      cancelled_at = case when r.return_type = 'cancellation' then now() else cancelled_at end,
      cancelled_by = case when r.return_type = 'cancellation' then v_uid else cancelled_by end
   where id = t.id;

  if v_refund > 0 then
    insert into public.payments(transaction_id, kind, mode, amount, reference, return_id, created_by)
    values (t.id, 'refund', case when r.refund_mode in ('cash','upi','card','bank','other','credit_note') then r.refund_mode else 'cash' end,
            v_refund, r.return_no, r.id, v_uid);
  end if;

  update public.returns set status = 'approved', approved_by = v_uid, approved_at = now(),
         refund_amount = v_refund, return_value = v_value, decision_note = left(coalesce(p_note,''),500)
   where id = r.id;

  insert into public.audit_logs(table_name, record_id, action, new_data, user_id)
  values ('returns', r.id::text, 'APPROVE', jsonb_build_object('return_no', r.return_no, 'value', v_value, 'refund', v_refund), v_uid);
  return jsonb_build_object('id', r.id, 'value', v_value, 'refund', v_refund);
end $$;

create or replace function public.reject_return(p_return_id uuid, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  v_uid := public.require_role('admin');
  update public.returns set status = 'rejected', approved_by = v_uid, approved_at = now(),
         decision_note = left(coalesce(p_note,''),500)
   where id = p_return_id and status = 'pending';
  if not found then raise exception 'RETURN_NOT_PENDING'; end if;
  insert into public.audit_logs(table_name, record_id, action, user_id) values ('returns', p_return_id::text, 'REJECT', v_uid);
end $$;

-- Record a later payment against an outstanding (credit) bill.
create or replace function public.add_payment(p_txn uuid, p_mode text, p_amount numeric, p_reference text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid; t public.transactions; v_alloc numeric[]; v_ids uuid[]; v_rem numeric[]; i int;
begin
  v_uid := public.require_role('admin','employee','accountant');
  select * into t from public.transactions where id = p_txn for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;
  if t.status = 'cancelled' then raise exception 'TRANSACTION_CANCELLED'; end if;
  p_amount := round(p_amount, 2);
  if p_amount <= 0 or p_amount > t.outstanding then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
  if p_mode not in ('cash','upi','card','bank','other') then raise exception 'INVALID_PAYMENT_MODE'; end if;
  insert into public.payments(transaction_id, kind, mode, amount, reference, created_by)
  values (t.id, 'payment', p_mode, p_amount, left(coalesce(p_reference,''),120), v_uid);
  -- allocate the new amount over receipts by remaining due
  select array_agg(id order by receipt_no), array_agg(greatest(total_amount - returned_amount - allocated_paid,0) order by receipt_no)
    into v_ids, v_rem from public.category_receipts where transaction_id = t.id;
  v_alloc := public.allocate_amount(p_amount, v_rem);
  for i in 1..array_length(v_ids,1) loop
    update public.category_receipts set allocated_paid = allocated_paid + v_alloc[i] where id = v_ids[i];
  end loop;
  update public.transactions set paid_amount = paid_amount + p_amount, outstanding = outstanding - p_amount,
         payment_mode = case when payment_mode in ('credit') then p_mode when payment_mode = p_mode then p_mode else 'split' end,
         payment_status = case when outstanding - p_amount <= 0 then 'paid' else 'partial' end
   where id = t.id;
end $$;

-- ---------------------------------------------------------------------
-- PRODUCTS & STOCK
-- ---------------------------------------------------------------------
-- payload: product fields + purchase_price + opening_stock (new products only)
create or replace function public.save_product(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid := nullif(p->>'id','')::uuid; v_admin boolean; v_open numeric; v_code text; v_bar text;
begin
  v_uid := public.require_role('admin','employee');
  v_admin := public.is_admin();
  if trim(coalesce(p->>'name_hi','')) = '' then raise exception 'NAME_REQUIRED: हिंदी नाम आवश्यक है'; end if;
  if coalesce((p->>'selling_price')::numeric,-1) < 0 then raise exception 'INVALID_PRICE'; end if;
  v_code := nullif(trim(coalesce(p->>'product_code','')), '');
  v_bar  := nullif(trim(coalesce(p->>'barcode','')), '');
  if v_code is null then v_code := 'P' || lpad(public.next_counter('product_code', 1001)::text, 5, '0'); end if;

  if v_id is null then
    insert into public.products(product_code, barcode, name_hi, name_en, category_id, selling_price, unit,
                                min_stock, gst_rate, hsn_code, image_url, is_active, created_by)
    values (v_code, v_bar, trim(p->>'name_hi'), trim(coalesce(p->>'name_en','')), (p->>'category_id')::uuid,
            round((p->>'selling_price')::numeric,2), coalesce(nullif(p->>'unit',''),'piece'),
            coalesce((p->>'min_stock')::numeric,0), coalesce((p->>'gst_rate')::numeric,0),
            coalesce(p->>'hsn_code',''), nullif(p->>'image_url',''), coalesce((p->>'is_active')::boolean,true), v_uid)
    returning id into v_id;
    v_open := coalesce((p->>'opening_stock')::numeric, 0);
    if v_open < 0 then raise exception 'INVALID_STOCK'; end if;
    if v_open > 0 then
      update public.inventory set opening_stock = v_open, quantity = v_open where product_id = v_id;
      insert into public.stock_movements(product_id, movement_type, quantity, balance_after, reference_type, reference_no, notes, created_by)
      values (v_id, 'opening', v_open, v_open, 'product', v_code, 'प्रारंभिक स्टॉक', v_uid);
    end if;
  else
    if not v_admin then raise exception 'PERMISSION_DENIED: केवल प्रशासक उत्पाद बदल सकते हैं' using errcode = '42501'; end if;
    update public.products set product_code = v_code, barcode = v_bar, name_hi = trim(p->>'name_hi'),
           name_en = trim(coalesce(p->>'name_en','')), category_id = (p->>'category_id')::uuid,
           selling_price = round((p->>'selling_price')::numeric,2), unit = coalesce(nullif(p->>'unit',''),'piece'),
           min_stock = coalesce((p->>'min_stock')::numeric,0), gst_rate = coalesce((p->>'gst_rate')::numeric,0),
           hsn_code = coalesce(p->>'hsn_code',''), image_url = nullif(p->>'image_url',''),
           is_active = coalesce((p->>'is_active')::boolean,true)
     where id = v_id;
    if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  end if;
  if v_admin and p ? 'purchase_price' and nullif(p->>'purchase_price','') is not null then
    update public.product_costs set purchase_price = round((p->>'purchase_price')::numeric,2) where product_id = v_id;
  end if;
  return v_id;
end $$;

-- payload: {"product_id","type":"purchase|adjustment_in|adjustment_out|damaged|opening","quantity">0,
--           "unit_cost","reference_no","notes"}
create or replace function public.stock_entry(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_type public.movement_type; v_qty numeric; v_signed numeric; v_new numeric; v_id bigint; s public.shop_settings;
begin
  v_uid := public.require_role('admin');
  v_type := (p->>'type')::public.movement_type;
  if v_type not in ('purchase','adjustment_in','adjustment_out','damaged','opening') then raise exception 'INVALID_MOVEMENT_TYPE'; end if;
  v_qty := round(coalesce((p->>'quantity')::numeric,0),3);
  if v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  v_signed := case when v_type in ('adjustment_out','damaged') then -v_qty else v_qty end;
  select * into s from public.shop_settings where id = 1;
  perform 1 from public.inventory where product_id = (p->>'product_id')::uuid for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  update public.inventory set quantity = quantity + v_signed,
         opening_stock = case when v_type = 'opening' then opening_stock + v_qty else opening_stock end,
         updated_at = now()
   where product_id = (p->>'product_id')::uuid returning quantity into v_new;
  if v_new < 0 and not s.allow_negative_stock then raise exception 'INSUFFICIENT_STOCK'; end if;
  insert into public.stock_movements(product_id, movement_type, quantity, balance_after, unit_cost, reference_type,
                                     reference_no, notes, created_by)
  values ((p->>'product_id')::uuid, v_type, v_signed, v_new, nullif(p->>'unit_cost','')::numeric,
          case when v_type = 'purchase' then 'purchase' else 'adjustment' end,
          left(coalesce(p->>'reference_no',''),80), left(coalesce(p->>'notes',''),300), v_uid)
  returning id into v_id;
  if v_type = 'purchase' and nullif(p->>'unit_cost','') is not null then
    update public.product_costs set purchase_price = round((p->>'unit_cost')::numeric,2) where product_id = (p->>'product_id')::uuid;
  end if;
  return v_id;
end $$;

-- Admin can delete a category only when nothing references it.
create or replace function public.delete_category(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_role('admin');
  if exists (select 1 from public.products where category_id = p_id)
     or exists (select 1 from public.category_receipts where category_id = p_id) then
    raise exception 'CATEGORY_IN_USE: इस श्रेणी में उत्पाद/बिल मौजूद हैं, इसे निष्क्रिय करें';
  end if;
  delete from public.categories where id = p_id;
  delete from public.receipt_counters where counter_key = p_id::text;
end $$;

-- ---------------------------------------------------------------------
-- REPORTS — totals come from master transactions & receipts (no double count)
--   gross sales  = Σ transactions.total_amount (bill date in range)
--   returns      = Σ approved return value (approval date in range)
--   net sales    = gross − returns
--   collections  = Σ payments − Σ refunds (cash-flow, by payment date)
-- ---------------------------------------------------------------------
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; tz text := public.app_tz();
begin
  if not public.has_role('admin','accountant') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  with
  tx as (select * from public.transactions where created_at >= p_from and created_at < p_to),
  rt as (select r.*, r.return_value as value_calc
           from public.returns r where r.status = 'approved' and r.approved_at >= p_from and r.approved_at < p_to),
  rti as (select ri.*, cr.category_id, r.approved_at from public.return_items ri
            join public.returns r on r.id = ri.return_id
            join public.category_receipts cr on cr.id = ri.receipt_id
           where r.status = 'approved' and r.approved_at >= p_from and r.approved_at < p_to),
  pm as (select * from public.payments where created_at >= p_from and created_at < p_to)
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'transactions', (select count(*) from tx),
      'bills', (select count(*) from public.category_receipts cr join tx on tx.id = cr.transaction_id),
      'items_qty', (select coalesce(sum(quantity),0) from public.transaction_items ti join tx on tx.id = ti.transaction_id),
      'gross_sales', (select coalesce(sum(total_amount),0) from tx),
      'discounts', (select coalesce(sum(line_discount + bill_discount),0) from tx),
      'tax', (select coalesce(sum(tax_amount),0) from tx),
      'returns', (select coalesce(sum(coalesce(value_calc,0)),0) from rt),
      'returns_count', (select count(*) from rt),
      'cancelled_count', (select count(*) from rt where return_type = 'cancellation'),
      'collections', (select coalesce(sum(case when kind='payment' then amount else -amount end),0) from pm),
      'refunds', (select coalesce(sum(amount),0) from pm where kind = 'refund'),
      'outstanding', (select coalesce(sum(outstanding),0) from tx where status <> 'cancelled')),
    'by_category', coalesce((select jsonb_agg(x order by x.sort_order) from (
        select c.id, c.name_hi, c.name_en, c.color, c.sort_order,
               coalesce(s.bills,0) bills, coalesce(s.amount,0) gross,
               coalesce(rr.amount,0) returns, coalesce(s.amount,0) - coalesce(rr.amount,0) net,
               coalesce(s.qty,0) qty
          from public.categories c
          left join (select cr.category_id, count(*) bills, sum(cr.total_amount) amount, sum(cr_q.q) qty
                       from public.category_receipts cr join tx on tx.id = cr.transaction_id
                       left join lateral (select sum(quantity) q from public.transaction_items ti where ti.receipt_id = cr.id) cr_q on true
                      group by 1) s on s.category_id = c.id
          left join (select category_id, sum(amount) amount from rti group by 1) rr on rr.category_id = c.id
         where s.bills is not null or rr.amount is not null or c.is_active) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(x order by x.amount desc) from (
        select ti.product_id, max(ti.product_name_hi) name_hi, max(ti.product_name_en) name_en, max(ti.product_code) code,
               sum(ti.quantity) qty, sum(ti.line_total) amount,
               coalesce((select sum(quantity) from rti where rti.product_id = ti.product_id),0) returned_qty
          from public.transaction_items ti join tx on tx.id = ti.transaction_id
         group by ti.product_id order by sum(ti.line_total) desc limit 200) x), '[]'::jsonb),
    'by_employee', coalesce((select jsonb_agg(x order by x.amount desc) from (
        select tx.created_by, coalesce(u.full_name,'') name, count(*) txns, sum(tx.total_amount) amount
          from tx left join public.users u on u.id = tx.created_by group by 1,2) x), '[]'::jsonb),
    'by_payment_mode', coalesce((select jsonb_agg(x order by x.net desc) from (
        select mode, sum(case when kind='payment' then amount else 0 end) received,
               sum(case when kind='refund' then amount else 0 end) refunded,
               sum(case when kind='payment' then amount else -amount end) net, count(*) cnt
          from pm group by mode) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select d.day, coalesce(g.gross,0) gross, coalesce(g.txns,0) txns, coalesce(r.ret,0) returns,
               coalesce(g.gross,0) - coalesce(r.ret,0) net
          from (select distinct (created_at at time zone tz)::date as day from tx
                union select distinct (approved_at at time zone tz)::date from rt) d
          left join (select (created_at at time zone tz)::date as day, sum(total_amount) gross, count(*) txns from tx group by 1) g on g.day = d.day
          left join (select (approved_at at time zone tz)::date as day, sum(coalesce(value_calc,0)) ret from rt group by 1) r on r.day = d.day) x), '[]'::jsonb)
  ) into v;
  -- cancellations store value in returns.items; fix returns total for cancellations (full remaining value)
  return v;
end $$;

-- Dashboard (all roles). Monthly chart = last 12 months, daily = last 30 days.
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.app_tz(); d0 timestamptz; v jsonb;
begin
  if public.current_role_code() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  d0 := date_trunc('day', now() at time zone tz) at time zone tz;
  select jsonb_build_object(
    'today_sales', (select coalesce(sum(total_amount),0) from public.transactions where created_at >= d0),
    'today_returns', (select coalesce(sum(r.return_value),0) from public.returns r
                       where r.status='approved' and r.approved_at >= d0),
    'today_collections', (select coalesce(sum(case when kind='payment' then amount else -amount end),0) from public.payments where created_at >= d0),
    'today_transactions', (select count(*) from public.transactions where created_at >= d0),
    'today_bills', (select count(*) from public.category_receipts where created_at >= d0),
    'pending_returns', (select count(*) from public.returns where status = 'pending'),
    'products_total', (select count(*) from public.products where is_active),
    'stock_units', (select coalesce(sum(i.quantity),0) from public.inventory i join public.products p on p.id = i.product_id where p.is_active),
    'low_stock', coalesce((select jsonb_agg(x) from (
        select p.id, p.name_hi, p.name_en, p.product_code, p.unit, i.quantity, p.min_stock
          from public.products p join public.inventory i on i.product_id = p.id
         where p.is_active and i.quantity <= p.min_stock order by i.quantity - p.min_stock limit 20) x), '[]'::jsonb),
    'low_stock_count', (select count(*) from public.products p join public.inventory i on i.product_id = p.id where p.is_active and i.quantity <= p.min_stock),
    'today_by_category', coalesce((select jsonb_agg(x order by x.sort_order) from (
        select c.name_hi, c.name_en, c.color, c.sort_order, count(cr.id) bills, coalesce(sum(cr.total_amount),0) amount
          from public.category_receipts cr join public.categories c on c.id = cr.category_id
         where cr.created_at >= d0 group by c.id) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (
        select t.id, t.txn_no, t.customer_name, t.total_amount, t.payment_mode, t.status, t.created_at,
               (select string_agg(receipt_no, ', ' order by receipt_no) from public.category_receipts where transaction_id = t.id) receipts
          from public.transactions t where public.can_view_txn(t.created_by, t.created_at)
         order by t.created_at desc limit 10) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select (created_at at time zone tz)::date as day, sum(total_amount) amount, count(*) txns
          from public.transactions where created_at >= d0 - interval '29 days' group by 1) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(created_at at time zone tz, 'YYYY-MM') as month, sum(total_amount) amount, count(*) txns
          from public.transactions where created_at >= date_trunc('month', d0) - interval '11 months' group by 1) x), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Register views (security_invoker => RLS of the caller applies)
-- ---------------------------------------------------------------------
create or replace view public.v_sales_register with (security_invoker = true) as
select cr.id as receipt_id, cr.transaction_id, t.created_at,
       (t.created_at at time zone 'Asia/Kolkata')::date as bill_date,
       t.txn_no, cr.category_id, cr.category_name_hi, cr.category_name_en, cr.receipt_no,
       t.customer_name, t.customer_mobile,
       (select string_agg(ti.product_name_hi || ' × ' || trim(to_char(ti.quantity,'FM999999990.###')), ', ' order by ti.line_no)
          from public.transaction_items ti where ti.receipt_id = cr.id) as product_details,
       (select sum(ti.quantity) from public.transaction_items ti where ti.receipt_id = cr.id) as quantity,
       cr.gross_amount, cr.line_discount + cr.bill_discount as discount, cr.total_amount, cr.allocated_paid,
       cr.returned_amount, t.payment_mode, cr.status, t.created_by, u.full_name as employee_name
  from public.category_receipts cr
  join public.transactions t on t.id = cr.transaction_id
  left join public.users u on u.id = t.created_by;

create or replace view public.v_master_register with (security_invoker = true) as
select t.id, t.txn_no, t.created_at, (t.created_at at time zone 'Asia/Kolkata')::date as bill_date,
       t.customer_name, t.customer_mobile,
       (select string_agg(cr.receipt_no || ' (' || cr.category_name_hi || ')', ', ' order by cr.receipt_no)
          from public.category_receipts cr where cr.transaction_id = t.id) as receipt_numbers,
       (select count(*) from public.category_receipts cr where cr.transaction_id = t.id) as receipts_count,
       t.items_count, t.gross_amount, t.line_discount + t.bill_discount as discount, t.total_amount,
       t.paid_amount, t.outstanding, t.returned_amount, t.refunded_amount,
       t.payment_mode, t.payment_status, t.status, t.created_by, u.full_name as employee_name
  from public.transactions t left join public.users u on u.id = t.created_by;

create or replace view public.v_returns_register with (security_invoker = true) as
select r.id, r.return_no, r.return_type, r.requested_at, r.approved_at, r.status, r.reason,
       r.refund_amount, r.refund_mode, r.restock, r.decision_note,
       t.id as transaction_id, t.txn_no, t.customer_name,
       (select string_agg(distinct cr.receipt_no, ', ') from public.return_items ri
          join public.category_receipts cr on cr.id = ri.receipt_id where ri.return_id = r.id) as receipt_numbers,
       (select string_agg(ti.product_name_hi || ' × ' || trim(to_char(ri.quantity,'FM999999990.###')), ', ')
          from public.return_items ri join public.transaction_items ti on ti.id = ri.transaction_item_id
         where ri.return_id = r.id) as products,
       (select sum(ri.quantity) from public.return_items ri where ri.return_id = r.id) as quantity,
       (select sum(ri.amount) from public.return_items ri where ri.return_id = r.id) as goods_value,
       r.requested_by, ru.full_name as requested_by_name, au.full_name as approved_by_name
  from public.returns r
  join public.transactions t on t.id = r.transaction_id
  left join public.users ru on ru.id = r.requested_by
  left join public.users au on au.id = r.approved_by;

create or replace view public.v_stock with (security_invoker = true) as
select p.id, p.product_code, p.barcode, p.name_hi, p.name_en, p.category_id, c.name_hi as category_name_hi,
       c.name_en as category_name_en, p.unit, p.selling_price, p.min_stock, p.is_active,
       coalesce(i.opening_stock,0) opening_stock, coalesce(i.quantity,0) quantity,
       coalesce(i.quantity,0) <= p.min_stock as is_low, i.updated_at as stock_updated_at
  from public.products p join public.categories c on c.id = p.category_id
  left join public.inventory i on i.product_id = p.id;
