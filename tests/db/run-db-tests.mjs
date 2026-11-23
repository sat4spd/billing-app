import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');

function readSql(name) {
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
    .replace(/create extension if not exists pgcrypto;/gi, '');
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.stack || err.message : String(err)}`);
  }
}

async function main() {
  console.log('Booting PGlite in-memory PostgreSQL...');
  const db = new PGlite();

  // Supabase auth + role stubs
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  `);

  // Apply migrations 0001 - 0005
  console.log('Applying migrations 0001 - 0005...');
  await db.exec(readSql('20261123000001_schema.sql'));
  await db.exec(readSql('20261123000002_functions.sql'));
  await db.exec(readSql('20261123000003_rls_seed.sql'));
  await db.exec(readSql('20261123000005_unlisted_items.sql'));

  const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
  const EMP_ID = '22222222-2222-2222-2222-222222222222';
  const ACC_ID = '33333333-3333-3333-3333-333333333333';

  await db.exec(`
    insert into auth.users(id, email, raw_user_meta_data) values
      ('${ADMIN_ID}', 'admin@khadi.in', '{"full_name":"प्रशासक जी"}'),
      ('${EMP_ID}', 'emp@khadi.in', '{"full_name":"रमेश कर्मचारी","created_by_admin":true,"role_code":"employee"}'),
      ('${ACC_ID}', 'acc@khadi.in', '{"full_name":"लेखाकार","created_by_admin":true,"role_code":"accountant"}');
  `);

  async function asUser(uid, fn) {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  }

  async function rpc(uid, fnName, argsObj) {
    return asUser(uid, async () => {
      const keys = Object.keys(argsObj || {});
      const placeholders = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      const vals = keys.map((k) => argsObj[k]);
      const res = await db.query(`select public.${fnName}(${placeholders}) as res`, vals);
      return res.rows[0].res;
    });
  }

  // Lookup category IDs
  const catsRes = await db.query(`select id, code from public.categories`);
  const catByCode = Object.fromEntries(catsRes.rows.map((r) => [r.code, r.id]));

  // Seed products via save_product as Admin
  const woolId = await rpc(ADMIN_ID, 'save_product', {
    p: {
      name_hi: 'ऊनी शॉल',
      name_en: 'Woollen Shawl',
      category_id: catByCode.woollen,
      product_code: 'W001',
      barcode: '8901234500011',
      selling_price: 2000,
      purchase_price: 1400,
      unit: 'piece',
      opening_stock: 10,
      min_stock: 2,
      gst_rate: 5,
    },
  });

  const silkId = await rpc(ADMIN_ID, 'save_product', {
    p: {
      name_hi: 'तसर रेशम साड़ी',
      name_en: 'Tussar Silk Saree',
      category_id: catByCode.silk,
      product_code: 'S001',
      barcode: '8901234500028',
      selling_price: 3900,
      purchase_price: 2800,
      unit: 'piece',
      opening_stock: 8,
      min_stock: 2,
      gst_rate: 5,
    },
  });

  const cottonId = await rpc(ADMIN_ID, 'save_product', {
    p: {
      name_hi: 'सूती चादर',
      name_en: 'Cotton Bedsheet',
      category_id: catByCode.cotton,
      product_code: 'C001',
      barcode: '', // no barcode!
      selling_price: 900,
      purchase_price: 600,
      unit: 'piece',
      opening_stock: 15,
      min_stock: 3,
      gst_rate: 5,
    },
  });

  let txn3Id = null;

  await test('T1: Single Woollen product generates 1 Woollen receipt', async () => {
    const res = await rpc(EMP_ID, 'create_bill', {
      p: {
        idempotency_key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        customer: { name: 'सरयुग प्रसाद गुप्ता' },
        items: [{ product_id: woolId, quantity: 1 }],
        payments: [{ mode: 'cash', amount: 2000, reference: '' }],
      },
    });
    assert.equal(res.duplicate, false);
    const detail = await rpc(EMP_ID, 'get_transaction_detail', { p_id: res.id });
    assert.equal(detail.receipts.length, 1);
    assert.equal(detail.receipts[0].category_id, catByCode.woollen);
    assert.equal(detail.receipts[0].receipt_no, 'ऊ-1');
    assert.equal(Number(detail.transaction.total_amount), 2000);
  });

  await test('T2: Silk + Cotton generates 2 separate receipts in 1 master transaction', async () => {
    const res = await rpc(EMP_ID, 'create_bill', {
      p: {
        idempotency_key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
        customer: { name: 'सीता देवी' },
        items: [
          { product_id: silkId, quantity: 1 },
          { product_id: cottonId, quantity: 1 },
        ],
        payments: [{ mode: 'cash', amount: 4800, reference: '' }],
      },
    });
    const detail = await rpc(EMP_ID, 'get_transaction_detail', { p_id: res.id });
    assert.equal(detail.receipts.length, 2);
    assert.equal(Number(detail.transaction.total_amount), 4800);
    for (const r of detail.receipts) {
      for (const it of r.items) {
        assert.equal(it.category_id, r.category_id);
      }
    }
  });

  await test('T3: Woollen + Silk + Cotton generates 3 receipts & increments category sequences independently', async () => {
    const res = await rpc(EMP_ID, 'create_bill', {
      p: {
        idempotency_key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
        customer: { name: 'मोहन लाल' },
        items: [
          { product_id: woolId, quantity: 1 },
          { product_id: silkId, quantity: 1 },
          { product_id: cottonId, quantity: 1 },
        ],
        payments: [{ mode: 'cash', amount: 6800, reference: '' }],
      },
    });
    txn3Id = res.id;
    const detail = await rpc(EMP_ID, 'get_transaction_detail', { p_id: res.id });
    assert.equal(detail.receipts.length, 3);
    assert.equal(Number(detail.transaction.total_amount), 6800);
    const woolR = detail.receipts.find((r) => r.category_id === catByCode.woollen);
    const silkR = detail.receipts.find((r) => r.category_id === catByCode.silk);
    assert.equal(woolR.receipt_no, 'ऊ-2');
    assert.equal(silkR.receipt_no, 'रे-2');
  });

  await test('T4/T5: Search by barcode and by Hindi name without barcode', async () => {
    const byBar = await asUser(EMP_ID, () =>
      db.query(`select id from public.products where barcode = $1`, ['8901234500011']),
    );
    assert.equal(byBar.rows[0].id, woolId);

    const byHindi = await asUser(EMP_ID, () =>
      db.query(`select id from public.products where search_text ilike $1`, ['%सूती चादर%']),
    );
    assert.equal(byHindi.rows[0].id, cottonId);
  });

  await test('T6: UPI payment recorded once with exact paise allocation across receipts', async () => {
    const res = await rpc(ADMIN_ID, 'create_bill', {
      p: {
        idempotency_key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6',
        customer: { name: 'अमित' },
        items: [
          { product_id: woolId, quantity: 1 },
          { product_id: cottonId, quantity: 1 },
        ],
        bill_discount: 100.01,
        payments: [{ mode: 'upi', amount: 2799.99, reference: 'UPI-998877' }],
      },
    });
    const detail = await rpc(ADMIN_ID, 'get_transaction_detail', { p_id: res.id });
    assert.equal(detail.payments.length, 1);
    assert.equal(detail.payments[0].mode, 'upi');
    assert.equal(detail.payments[0].reference, 'UPI-998877');
    const allocSum = detail.receipts.reduce((s, r) => s + Number(r.allocated_paid), 0);
    assert.equal(Math.round(allocSum * 100), 279999);
  });

  await test('T7: Inventory deducts and stock_movements references transaction', async () => {
    const inv = await db.query(`select quantity from public.inventory where product_id = $1`, [woolId]);
    // Started 10, sold 1 (T1) + 1 (T3) + 1 (T6) = 7 left
    assert.equal(Number(inv.rows[0].quantity), 7);
    const mv = await db.query(
      `select movement_type, quantity from public.stock_movements where reference_id = $1 and product_id = $2`,
      [txn3Id, woolId],
    );
    assert.equal(mv.rows[0].movement_type, 'sale');
    assert.equal(Number(mv.rows[0].quantity), -1);
  });

  await test('T8: Employee requests cancellation, cannot approve; Admin approves & restores stock', async () => {
    const req = await rpc(EMP_ID, 'request_return', {
      p: { transaction_id: txn3Id, type: 'cancellation', reason: 'गलत बिल', refund_mode: 'cash', restock: true },
    });
    await assert.rejects(
      () => rpc(EMP_ID, 'approve_return', { p_return_id: req.id, p_note: 'try' }),
      /PERMISSION_DENIED/,
    );
    await rpc(ADMIN_ID, 'approve_return', { p_return_id: req.id, p_note: 'ok' });

    const detail = await rpc(ADMIN_ID, 'get_transaction_detail', { p_id: txn3Id });
    assert.equal(detail.transaction.status, 'cancelled');
    assert.ok(detail.receipts.every((r) => r.status === 'cancelled'));
    // Woollen stock restored from 7 -> 8
    const inv = await db.query(`select quantity from public.inventory where product_id = $1`, [woolId]);
    assert.equal(Number(inv.rows[0].quantity), 8);
  });

  await test('T10: report_summary totals match master transactions without double counting', async () => {
    const rep = await rpc(ACC_ID, 'report_summary', {
      p_from: '2020-01-01T00:00:00Z',
      p_to: '2030-01-01T00:00:00Z',
    });
    const txSum = await db.query(`select sum(total_amount) s from public.transactions`);
    assert.equal(Number(rep.totals.gross_sales), Number(txSum.rows[0].s));
    const catGrossSum = rep.by_category.reduce((s, c) => s + Number(c.gross), 0);
    assert.equal(Math.round(catGrossSum * 100), Math.round(Number(rep.totals.gross_sales) * 100));
    // T1 (2000) + T2 (4800) + T3 (6800) + T6 (2799.99) = 16399.99; T3 cancelled (6800) => net 9599.99
    assert.equal(Math.round((rep.totals.gross_sales - rep.totals.returns) * 100), 959999);
    // v_sales_register total equals gross_sales
    const regSum = await asUser(ACC_ID, () => db.query(`select sum(total_amount) s from public.v_sales_register`));
    assert.equal(Number(regSum.rows[0].s), Number(rep.totals.gross_sales));
  });

  await test('Idempotency: duplicate create_bill call returns duplicate=true', async () => {
    const res = await rpc(EMP_ID, 'create_bill', {
      p: {
        idempotency_key: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        items: [{ product_id: woolId, quantity: 1 }],
        payments: [{ mode: 'cash', amount: 2000 }],
      },
    });
    assert.equal(res.duplicate, true);
  });

  await test('Guards: Insufficient stock, unauthorized price edit, DELETE blocked, credit customer check', async () => {
    await assert.rejects(
      () =>
        rpc(EMP_ID, 'create_bill', {
          p: {
            idempotency_key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
            items: [{ product_id: woolId, quantity: 999 }],
            payments: [{ mode: 'cash', amount: 100 }],
          },
        }),
      /INSUFFICIENT_STOCK/,
    );

    await assert.rejects(
      () =>
        rpc(EMP_ID, 'create_bill', {
          p: {
            idempotency_key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
            items: [{ product_id: woolId, quantity: 1, rate: 500 }],
            payments: [{ mode: 'cash', amount: 500 }],
          },
        }),
      /PRICE_EDIT_NOT_ALLOWED/,
    );

    await assert.rejects(
      () => db.exec(`delete from public.transactions where id = '${txn3Id}'`),
      /DELETE_NOT_ALLOWED/,
    );

    await assert.rejects(
      () =>
        rpc(EMP_ID, 'create_bill', {
          p: {
            idempotency_key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
            items: [{ product_id: woolId, quantity: 1 }],
            payments: [{ mode: 'cash', amount: 500 }],
          },
        }),
      /CUSTOMER_REQUIRED_FOR_CREDIT/,
    );
  });

  await test('Unlisted item: employee can bill unlisted item alongside listed item & cancel cleanly', async () => {
    const res = await rpc(EMP_ID, 'create_bill', {
      p: {
        idempotency_key: 'cccccccc-cccc-cccc-cccc-ccccccccccc1',
        customer: { name: 'राजू' },
        items: [
          { product_id: woolId, quantity: 1 },
          {
            product_id: null,
            category_id: catByCode.khadi,
            name_hi: 'विशेष खादी कुर्ता',
            unit: 'piece',
            quantity: 2,
            rate: 750,
          },
        ],
        payments: [{ mode: 'cash', amount: 3500, reference: '' }],
      },
    });
    const detail = await rpc(EMP_ID, 'get_transaction_detail', { p_id: res.id });
    assert.equal(detail.receipts.length, 2);
    assert.equal(Number(detail.transaction.total_amount), 3500);
    const khadiR = detail.receipts.find((r) => r.category_id === catByCode.khadi);
    assert.equal(khadiR.items[0].product_name_hi, 'विशेष खादी कुर्ता');
    assert.equal(khadiR.items[0].product_id, null);

    // Cancel as admin -> should restore woolId stock and skip restock for unlisted item
    const req = await rpc(ADMIN_ID, 'request_return', {
      p: { transaction_id: res.id, type: 'cancellation', reason: 'test', auto_approve: true },
    });
    assert.ok(req.id);
  });

  console.log(`\nDB Test Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
