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
