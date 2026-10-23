'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

// Source-level regression checks. These do not replace Firebase Emulator tests;
// they guard the specific validation and transaction patterns against accidental removal.
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'index.js'),'utf8');

test('checkout rejects duplicate SKU keys that differ only by case',()=>{
  assert.match(source,/const normalizedSkus=new Set\(\);[\s\S]*?sku\.toUpperCase\(\)[\s\S]*?Duplicate product SKU keys are not allowed/);
});

test('checkout rejects malformed SKU document identifiers',()=>{
  assert.match(source,/!\s*\/\^\[A-Za-z0-9\._-\]\{1,100\}\$\/\.test\(sku\)/);
});

test('checkout accepts only numeric safe-integer quantities within the limit',()=>{
  assert.match(source,/typeof qty!==\x27number\x27\|\|!Number\.isSafeInteger\(qty\)\|\|qty<1\|\|qty>100000/);
});

test('checkout requires a stable request ID and stores an idempotency fingerprint',()=>{
  assert.match(source,/valid checkout request ID is required/);
  assert.match(source,/crypto\.createHash\('sha256'\)[\s\S]*?checkoutRequests/);
  assert.match(source,/saved\.fingerprint!==fingerprint/);
  assert.match(source,/tx\.create\(ref,order\)/);
  assert.match(source,/tx\.create\(requestRef/);
});

test('order status changes require active staff and valid order IDs',()=>{
  assert.match(source,/userSnap\.data\(\)\.active!==true\|\|!\[\x27staff\x27,\x27admin\x27\]\.includes\(userSnap\.data\(\)\.role\)/);
  assert.match(source,/A valid order ID and target status are required/);
});

test('inventory workflow validates SKU, combined quantities, and next stock',()=>{
  assert.match(source,/Order contains an invalid product SKU/);
  assert.match(source,/!Number\.isSafeInteger\(combined\)\|\|combined>100000/);
  assert.match(source,/const nextStock=stock\+\(deduct\?-qty:qty\)/);
  assert.match(source,/!Number\.isFinite\(nextStock\)\|\|nextStock<0/);
});

test('order status changes and stock history remain in one transaction',()=>{
  assert.match(source,/await db\.runTransaction\(async tx=>\{/);
  assert.match(source,/tx\.update\(orderRef,\{status:to/);
  assert.match(source,/tx\.set\(db\.collection\(\x27inventoryHistory\x27\)\.doc\(\)/);
});

test('manual stock adjustments are admin-guarded, bounded, and audited transactionally',()=>{
  assert.match(source,/exports\.adjustStock=onCall\(opt,async req=>\{\s*await guard\(req\)/);
  assert.match(source,/Stock change must be a non-zero whole number/);
  assert.match(source,/This adjustment would create invalid or negative stock/);
  assert.match(source,/reason:\x60adjustment: \x24\{data\.reason\.trim\(\)\}\x60/);
  assert.match(source,/tx\.update\(productRef,\{stock:next\}\)[\s\S]*?inventoryHistory/);
});


test('supplier stock receiving is admin-guarded, validates quantities, and audits supplier reference',()=>{
  assert.match(source,/exports\.receiveStock=onCall\(opt,async req=>\{\s*await guard\(req\)/);
  assert.match(source,/Received quantity must be a whole number from 1 to 100000/);
  assert.match(source,/Delivery note or invoice reference is required/);
  assert.match(source,/type:'supplier_receipt',supplier,reference,quantity:data\.quantity/);
  assert.match(source,/tx\.update\(productRef,\{stock:next\}\)[\s\S]*?supplier_receipt/);
});


test('physical stock count reconciliation checks stale balances and records variance',()=>{
  assert.match(source,/exports\.reconcileStockCount=onCall\(opt,async req=>\{\s*await guard\(req\)/);
  assert.match(source,/Stock changed since this count was started/);
  assert.match(source,/type:'stock_count',expectedStock:current,countedStock:data\.countedStock/);
  assert.match(source,/variance,reason:\x60stock_count: \x24\{reason\}\x60/);
  assert.match(source,/tx\.update\(productRef,\{stock:data\.countedStock\}\)[\s\S]*?stock_count/);
});


test('supplier directory writes are admin-guarded and validate contact fields',()=>{
  assert.match(source,/exports\.saveSupplier=onCall\(opt,async req=>\{\s*await guard\(req\)/);
  assert.match(source,/Supplier name is required/);
  assert.match(source,/Enter a valid supplier email address/);
  assert.match(source,/Supplier ID is invalid/);
  assert.match(source,/updatedBy:req\.auth\.uid/);
});


test('checkout App Check enforcement is opt-in through an explicit environment flag',()=>{
  assert.match(source,/const checkoutAppCheckEnforced=process\.env\.ENFORCE_CHECKOUT_APP_CHECK==='true'/);
  assert.match(source,/onCall\(\{\.\.\.opt, enforceAppCheck:checkoutAppCheckEnforced\}/);
});


test('private product migration preserves existing staff prices and removes legacy public price fields',()=>{
  assert.match(source,/exports\.migratePrivateProductFields=onCall/);
  assert.match(source,/db\.getAll\(\.\.\.staffRefs\)/);
  assert.match(source,/!existingStaffPrices\[i\]\.exists&&Number\.isFinite\(legacyPrice\)/);
  assert.match(source,/remove\.staffPrice=FieldValue\.delete\(\)/);
  assert.match(source,/staffPricesMigrated/);
});
