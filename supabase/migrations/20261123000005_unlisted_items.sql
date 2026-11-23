-- =====================================================================
-- Support billing unlisted (ad-hoc / custom) products without requiring
-- them to exist in the `products` master table.
-- =====================================================================

alter table public.transaction_items alter column product_id drop not null;
alter table public.return_items      alter column product_id drop not null;

-- Update create_bill to handle items where product_id is null
create or replace function public.create_bill(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_key uuid; v_existing public.transactions;
  s public.shop_settings; v_is_admin boolean; v_can_price boolean; v_can_disc boolean;
  it record; prod record; cat record; v_lines jsonb := '[]'::jsonb; v_line_no int := 0;
  v_pid uuid; v_cid uuid; v_csort int; v_pcode text; v_name_hi text; v_name_en text; v_unit text;
  v_list_price numeric; v_gst numeric;
  v_qty numeric; v_rate numeric; v_disc numeric; v_base numeric; v_tax numeric; v_total_line numeric;
  v_cat_ids uuid[]; v_cat_net numeric[]; v_cat_bd numeric[]; v_cat_tot numeric[]; v_cat_alloc numeric[];
  v_gross numeric := 0; v_ldisc numeric := 0; v_net numeric := 0; v_bdisc numeric; v_total numeric; v_taxsum numeric := 0;
  v_paid numeric := 0; v_modes text[]; v_mode text; v_pstatus text;
  v_cust_id uuid; v_cname text; v_cmobile text; v_caddr text; v_ctype text;
  v_txn_id uuid := gen_random_uuid(); v_txn_seq bigint; v_txn_no text;
  c record; v_key_txt text; v_seq bigint; i int; v_alloc_sum numeric;
  pay record; v_override boolean; mv record; v_new_qty numeric;
begin
  v_uid := public.require_role('admin','employee');
  v_key := nullif(p->>'idempotency_key','')::uuid;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

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

  -- Lock inventory rows only for listed products
  perform 1 from public.inventory
   where product_id in (
     select nullif(e->>'product_id','')::uuid
       from jsonb_array_elements(p->'items') e
      where nullif(e->>'product_id','') is not null
   )
   order by product_id for update;

  for it in select e, ord from jsonb_array_elements(p->'items') with ordinality t(e, ord) loop
    v_pid := nullif(it.e->>'product_id','')::uuid;

    if v_pid is not null then
      select pr.*, c2.name_hi as cat_name_hi, c2.sort_order as cat_sort, c2.is_active as cat_active
        into prod
        from public.products pr join public.categories c2 on c2.id = pr.category_id
       where pr.id = v_pid;
      if not found then raise exception 'PRODUCT_NOT_FOUND: %', v_pid; end if;
      if not prod.is_active then raise exception 'PRODUCT_INACTIVE: %', prod.name_hi; end if;

      v_cid := prod.category_id;
      v_csort := prod.cat_sort;
      v_pcode := prod.product_code;
      v_name_hi := prod.name_hi;
      v_name_en := prod.name_en;
      v_unit := prod.unit;
      v_list_price := prod.selling_price;
      v_gst := prod.gst_rate;

      v_rate := coalesce(round((it.e->>'rate')::numeric, 2), prod.selling_price);
      if v_rate < 0 then raise exception 'INVALID_RATE: %', v_name_hi; end if;
      if v_rate <> prod.selling_price and not v_can_price then
        raise exception 'PRICE_EDIT_NOT_ALLOWED: %', v_name_hi using errcode = '42501';
      end if;
    else
      -- Unlisted / custom item
      v_cid := nullif(it.e->>'category_id','')::uuid;
      if v_cid is null then raise exception 'CATEGORY_REQUIRED: श्रेणी चुनें'; end if;
      select * into cat from public.categories where id = v_cid;
      if not found then raise exception 'CATEGORY_NOT_FOUND'; end if;

      v_name_hi := trim(coalesce(it.e->>'name_hi',''));
      if v_name_hi = '' then raise exception 'NAME_REQUIRED: हिंदी नाम आवश्यक है'; end if;
      v_name_en := trim(coalesce(it.e->>'name_en',''));
      v_csort := cat.sort_order;
      v_pcode := coalesce(nullif(trim(coalesce(it.e->>'product_code','')), ''), 'UNLISTED');
      v_unit := coalesce(nullif(trim(coalesce(it.e->>'unit','')), ''), 'piece');
      v_gst := greatest(0, least(28, coalesce((it.e->>'gst_rate')::numeric, 0)));

      v_rate := round(coalesce((it.e->>'rate')::numeric, -1), 2);
      if v_rate < 0 then raise exception 'INVALID_RATE: %', v_name_hi; end if;
      v_list_price := v_rate;
    end if;

    v_qty := round(coalesce((it.e->>'quantity')::numeric, 0), 3);
    if v_qty <= 0 then raise exception 'INVALID_QUANTITY: %', v_name_hi; end if;

    v_disc := round(coalesce((it.e->>'discount')::numeric, 0), 2);
    if v_disc < 0 then raise exception 'INVALID_DISCOUNT'; end if;
    if v_disc > 0 and not v_can_disc then raise exception 'DISCOUNT_NOT_ALLOWED' using errcode = '42501'; end if;
    v_base := round(v_qty * v_rate, 2);
    if v_disc > v_base then raise exception 'DISCOUNT_EXCEEDS_AMOUNT: %', v_name_hi; end if;
    if v_disc > 0 and not v_is_admin and v_disc > round(v_base * s.max_discount_percent / 100, 2) then
      raise exception 'DISCOUNT_LIMIT: max % %%', s.max_discount_percent using errcode = '42501';
    end if;

    if s.prices_include_gst then
      v_total_line := v_base - v_disc;
      v_tax := round(v_total_line * v_gst / (100 + v_gst), 2);
    else
      v_tax := round((v_base - v_disc) * v_gst / 100, 2);
      v_total_line := v_base - v_disc + v_tax;
    end if;

    v_line_no := v_line_no + 1;
    v_lines := v_lines || jsonb_build_object(
      'line_no', v_line_no, 'product_id', v_pid, 'category_id', v_cid,
      'cat_sort', v_csort, 'product_code', v_pcode, 'name_hi', v_name_hi,
      'name_en', v_name_en, 'unit', v_unit, 'qty', v_qty, 'list_price', v_list_price,
      'rate', v_rate, 'discount', v_disc, 'gst_rate', v_gst, 'tax', v_tax,
      'gross', v_base, 'line_total', v_total_line);
    v_gross := v_gross + v_base; v_ldisc := v_ldisc + v_disc; v_net := v_net + v_total_line; v_taxsum := v_taxsum + v_tax;
  end loop;

  -- Stock validation (only listed products)
  for mv in
    select (l->>'product_id')::uuid pid, max(l->>'name_hi') nm, sum((l->>'qty')::numeric) q
      from jsonb_array_elements(v_lines) l
     where nullif(l->>'product_id','') is not null
     group by 1
  loop
    if (select quantity from public.inventory where product_id = mv.pid) < mv.q
       and not s.allow_negative_stock and not v_override then
      raise exception 'INSUFFICIENT_STOCK: % (उपलब्ध %)', mv.nm,
        (select quantity from public.inventory where product_id = mv.pid);
    end if;
  end loop;

  -- Group by category
  select array_agg(cid order by srt, cid), array_agg(net order by srt, cid)
    into v_cat_ids, v_cat_net
    from (select (l->>'category_id')::uuid cid, min((l->>'cat_sort')::int) srt,
                 sum((l->>'line_total')::numeric) net
            from jsonb_array_elements(v_lines) l group by 1) g;

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

  v_txn_seq := public.next_counter('txn', 1);
  v_txn_no := s.txn_prefix || lpad(v_txn_seq::text, 6, '0');
  insert into public.transactions(id, txn_no, txn_seq, idempotency_key, customer_id, customer_name,
      customer_mobile, customer_address, customer_type, items_count, gross_amount, line_discount,
      bill_discount, total_amount, tax_amount, paid_amount, outstanding, payment_mode, payment_status,
      notes, created_by)
  values (v_txn_id, v_txn_no, v_txn_seq, v_key, v_cust_id, v_cname, v_cmobile, v_caddr, v_ctype,
      v_line_no, v_gross, v_ldisc, v_bdisc, v_total, v_taxsum, v_paid, v_total - v_paid, v_mode, v_pstatus,
      left(coalesce(p->>'notes',''), 500), v_uid);

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

  insert into public.transaction_items(transaction_id, receipt_id, category_id, product_id, line_no,
      product_code, product_name_hi, product_name_en, unit, quantity, list_price, rate, discount,
      gst_rate, tax_amount, line_total)
  select v_txn_id, cr.id, cr.category_id, nullif(l->>'product_id','')::uuid, (l->>'line_no')::int,
         l->>'product_code', l->>'name_hi', coalesce(l->>'name_en',''), l->>'unit', (l->>'qty')::numeric,
         (l->>'list_price')::numeric, (l->>'rate')::numeric, (l->>'discount')::numeric,
         (l->>'gst_rate')::numeric, (l->>'tax')::numeric, (l->>'line_total')::numeric
    from jsonb_array_elements(v_lines) l
    join public.category_receipts cr on cr.transaction_id = v_txn_id and cr.category_id = (l->>'category_id')::uuid;

  -- Stock deduction + movements (only listed products)
  for mv in select (l->>'product_id')::uuid pid, sum((l->>'qty')::numeric) q
              from jsonb_array_elements(v_lines) l
             where nullif(l->>'product_id','') is not null
             group by 1 order by 1 loop
    update public.inventory set quantity = quantity - mv.q, updated_at = now()
     where product_id = mv.pid returning quantity into v_new_qty;
    insert into public.stock_movements(product_id, movement_type, quantity, balance_after,
        reference_type, reference_id, reference_no, created_by)
    values (mv.pid, 'sale', -mv.q, v_new_qty, 'transaction', v_txn_id, v_txn_no, v_uid);
  end loop;

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

-- Update approve_return to skip restocking when product_id is null
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

  perform 1 from public.inventory
   where product_id in (select product_id from public.return_items where return_id = r.id and product_id is not null)
   order by product_id for update;

  for ri in select x.*, ti.quantity as sold_qty, ti.returned_qty
              from public.return_items x join public.transaction_items ti on ti.id = x.transaction_item_id
             where x.return_id = r.id loop
    if ri.quantity > ri.sold_qty - ri.returned_qty then raise exception 'RETURN_QTY_EXCEEDS'; end if;
    update public.transaction_items set returned_qty = returned_qty + ri.quantity where id = ri.transaction_item_id;
    update public.category_receipts set returned_amount = returned_amount + ri.amount where id = ri.receipt_id;
    v_value := v_value + ri.amount;
    if r.restock and ri.product_id is not null then
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
