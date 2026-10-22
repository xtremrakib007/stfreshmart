'use strict';
const {test,beforeEach,describe}=require('node:test');
const assert=require('node:assert/strict');
const {db,auth,resetEmulators,createUser,call}=require('./helpers');

const pickup={date:'2026-11-01',time:'10:00',collector:'Ali'};
const customer={name:'Test Customer',phone:'0123456789',company:''};
let requestSeq=0;
const orderData=(items,extra={})=>({requestId:`emulator-checkout-request-${++requestSeq}`,customer,method:'SELF PICKUP',delivery:pickup,items,...extra});

let adminToken,staffToken,inactiveStaffToken,inactiveAdminToken,customerToken;

beforeEach(async()=>{
  await resetEmulators();
  adminToken=await createUser('admin',{role:'admin',active:true});
  staffToken=await createUser('staff',{role:'staff',active:true});
  inactiveStaffToken=await createUser('inactiveStaff',{role:'staff',active:false});
  inactiveAdminToken=await createUser('inactiveAdmin',{role:'admin',active:false});
  customerToken=await createUser('customer');
  await db.doc('products/RICE5').set({name:'Rice 5kg',unit:'BAG',status:'active',retailPrice:20,stock:50,
    priceSlabs:[{minQty:10,price:18},{minQty:30,price:16}]});
  await db.doc('products/OIL1').set({name:'Oil 1L',unit:'BTL',status:'active',retailPrice:8,promoPrice:7,stock:5});
  await db.doc('products/HIDDEN').set({name:'Hidden',status:'inactive',retailPrice:5,stock:100});
  await db.doc('staffPrices/RICE5').set({price:15});
});

const errorStatus=r=>r.error&&r.error.status;
const stock=async sku=>(await db.doc(`products/${sku}`).get()).data().stock;

describe('createOrder',()=>{
  test('prices guest orders on the server and ignores client-supplied totals',async()=>{
    const r=await call('createOrder',orderData({RICE5:2,OIL1:1},{total:0,prices:{RICE5:0}}));
    assert.equal(r.result.total,2*20+7);
    const order=(await db.doc(`orders/${r.result.orderId}`).get()).data();
    assert.equal(order.total,47);
    assert.equal(order.status,'Pending');
    assert.equal(order.placedBy,'customer');
    assert.deepEqual(order.items.map(i=>[i.sku,i.qty,i.price]),[['RICE5',2,20],['OIL1',1,7]]);
  });

  test('returns the original order for a repeated checkout request ID',async()=>{
    const data=orderData({RICE5:2},{requestId:'same-checkout-request-id-0001'});
    const first=await call('createOrder',data);
    const retry=await call('createOrder',data);
    assert.equal(retry.result.orderId,first.result.orderId);
    assert.equal(retry.result.total,first.result.total);
    assert.equal((await db.collection('orders').get()).size,1);
  });

  test('returns the original order on retry even after stock becomes unavailable',async()=>{
    const data=orderData({OIL1:4},{requestId:'retry-after-stock-change-0001'});
    const first=await call('createOrder',data);
    await db.doc('products/OIL1').update({stock:0,status:'inactive'});
    const retry=await call('createOrder',data);
    assert.equal(retry.result.orderId,first.result.orderId);
    assert.equal(retry.result.total,first.result.total);
    assert.equal((await db.collection('orders').get()).size,1);
  });

  test('concurrent retries with the same checkout request ID create one order',async()=>{
    const data=orderData({RICE5:2},{requestId:'parallel-checkout-request-0001'});
    const [a,b]=await Promise.all([call('createOrder',data),call('createOrder',data)]);
    assert.equal(a.result.orderId,b.result.orderId);
    assert.equal((await db.collection('orders').get()).size,1);
    assert.equal((await db.collection('checkoutRequests').get()).size,1);
  });

  test('rejects reuse of a checkout request ID with changed order details',async()=>{
    const requestId='changed-payload-checkout-0001';
    const first=await call('createOrder',orderData({RICE5:2},{requestId}));
    const changed=await call('createOrder',orderData({RICE5:3},{requestId}));
    assert.equal(errorStatus(changed),'FAILED_PRECONDITION');
    assert.equal((await db.collection('orders').get()).size,1);
    assert.equal(first.result.total,40);
  });

  test('rejects missing or malformed checkout request IDs',async()=>{
    const missing=orderData({RICE5:1});
    delete missing.requestId;
    assert.equal(errorStatus(await call('createOrder',missing)),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',orderData({RICE5:1},{requestId:'short'}))),'INVALID_ARGUMENT');
  });

  test('applies the highest matching quantity price slab',async()=>{
    assert.equal((await call('createOrder',orderData({RICE5:10}))).result.total,180);
    assert.equal((await call('createOrder',orderData({RICE5:30}))).result.total,480);
  });

  test('uses staff prices only for active staff',async()=>{
    assert.equal((await call('createOrder',orderData({RICE5:2}),staffToken)).result.total,30);
    assert.equal((await call('createOrder',orderData({RICE5:2}),inactiveStaffToken)).result.total,40);
    assert.equal((await call('createOrder',orderData({RICE5:2}),customerToken)).result.total,40);
  });

  test('does not deduct stock when an order is placed',async()=>{
    await call('createOrder',orderData({RICE5:5}));
    assert.equal(await stock('RICE5'),50);
  });

  test('customers cannot order inactive products, active staff can',async()=>{
    assert.equal(errorStatus(await call('createOrder',orderData({HIDDEN:1}))),'FAILED_PRECONDITION');
    assert.ok((await call('createOrder',orderData({HIDDEN:1}),staffToken)).result);
  });

  test('rejects orders above available stock',async()=>{
    assert.equal(errorStatus(await call('createOrder',orderData({OIL1:6}))),'FAILED_PRECONDITION');
  });

  test('rejects invalid quantities',async()=>{
    for(const qty of ['5',1.5,0,-1,100001,null])
      assert.equal(errorStatus(await call('createOrder',orderData({RICE5:qty}))),'INVALID_ARGUMENT',`qty ${qty}`);
  });

  test('rejects malformed and case-duplicate SKUs',async()=>{
    assert.equal(errorStatus(await call('createOrder',orderData({'RICE5/../x':1}))),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',orderData({RICE5:1,rice5:1}))),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',orderData({}))),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',orderData(['RICE5']))),'INVALID_ARGUMENT');
  });

  test('requires delivery details for the chosen method',async()=>{
    assert.equal(errorStatus(await call('createOrder',{customer,method:'SELF PICKUP',delivery:{},items:{RICE5:1}})),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',{customer,method:'STANDARD DELIVERY',delivery:{date:'2026-11-01'},items:{RICE5:1}})),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',{customer,method:'FREE DELIVERY',delivery:pickup,items:{RICE5:1}})),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('createOrder',{customer:{name:'',phone:'1'},method:'SELF PICKUP',delivery:pickup,items:{RICE5:1}})),'INVALID_ARGUMENT');
  });
});

describe('updateOrderStatus',()=>{
  const placeOrder=async items=>(await db.collection('orders').add({status:'Pending',items,total:0})).id;

  test('rejects signed-out users, customers and inactive staff',async()=>{
    const id=await placeOrder([{sku:'RICE5',qty:1}]);
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Accepted'})),'UNAUTHENTICATED');
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Accepted'},customerToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Accepted'},inactiveStaffToken)),'PERMISSION_DENIED');
    assert.equal((await db.doc(`orders/${id}`).get()).data().status,'Pending');
  });

  test('accepting deducts stock and records history; cancelling restores it',async()=>{
    const id=await placeOrder([{sku:'RICE5',qty:3},{sku:'OIL1',qty:2}]);
    assert.ok((await call('updateOrderStatus',{orderId:id,to:'Accepted'},staffToken)).result);
    assert.equal(await stock('RICE5'),47);
    assert.equal(await stock('OIL1'),3);
    const order=(await db.doc(`orders/${id}`).get()).data();
    assert.equal(order.status,'Accepted');
    assert.equal(order.stockDeducted,true);
    const history=(await db.collection('inventoryHistory').get()).docs.map(d=>d.data());
    assert.equal(history.length,2);
    assert.ok(history.every(h=>h.reason===`order ${id}`&&h.changedBy==='staff'));

    assert.ok((await call('updateOrderStatus',{orderId:id,to:'Cancelled'},staffToken)).result);
    assert.equal(await stock('RICE5'),50);
    assert.equal(await stock('OIL1'),5);
    assert.equal((await db.doc(`orders/${id}`).get()).data().stockDeducted,false);
  });

  test('combines duplicate SKU lines before deducting stock',async()=>{
    const id=await placeOrder([{sku:'RICE5',qty:2},{sku:'rice5',qty:3}]);
    assert.ok((await call('updateOrderStatus',{orderId:id,to:'Accepted'},staffToken)).result);
    assert.equal(await stock('RICE5'),45);
  });

  test('refuses acceptance without enough stock and changes nothing',async()=>{
    const id=await placeOrder([{sku:'RICE5',qty:2},{sku:'OIL1',qty:6}]);
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Accepted'},staffToken)),'FAILED_PRECONDITION');
    assert.equal(await stock('RICE5'),50);
    assert.equal((await db.doc(`orders/${id}`).get()).data().status,'Pending');
    assert.equal((await db.collection('inventoryHistory').get()).size,0);
  });

  test('allows only valid status transitions',async()=>{
    const id=await placeOrder([{sku:'RICE5',qty:1}]);
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Delivered'},staffToken)),'FAILED_PRECONDITION');
    for(const to of ['Accepted','Preparing','Ready','Out For Delivery','Delivered'])
      assert.ok((await call('updateOrderStatus',{orderId:id,to},staffToken)).result,to);
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Cancelled'},staffToken)),'FAILED_PRECONDITION');
    assert.equal(await stock('RICE5'),49);
  });

  test('rejects invalid order IDs and invalid stored items',async()=>{
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:'a/b',to:'Accepted'},staffToken)),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:'missing',to:'Accepted'},staffToken)),'NOT_FOUND');
    const id=await placeOrder([{sku:'../users/admin',qty:1}]);
    assert.equal(errorStatus(await call('updateOrderStatus',{orderId:id,to:'Accepted'},staffToken)),'FAILED_PRECONDITION');
  });
});

describe('staff management',()=>{
  test('only active admins can manage staff',async()=>{
    const data={name:'New Staff',email:'new@example.test',role:'staff'};
    assert.equal(errorStatus(await call('createStaff',data)),'UNAUTHENTICATED');
    assert.equal(errorStatus(await call('createStaff',data,staffToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('createStaff',data,inactiveAdminToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('setStaffActive',{uid:'staff',active:false},staffToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('resetStaffPassword',{uid:'staff'},staffToken)),'PERMISSION_DENIED');
  });

  test('createStaff creates an Auth account, profile and reset link',async()=>{
    const r=await call('createStaff',{name:' New Staff ',email:' NEW@Example.test ',role:'staff'},adminToken);
    assert.ok(r.result.link);
    const profile=(await db.doc(`users/${r.result.uid}`).get()).data();
    assert.equal(profile.email,'new@example.test');
    assert.equal(profile.name,'New Staff');
    assert.equal(profile.active,true);
    assert.equal((await auth.getUser(r.result.uid)).email,'new@example.test');
  });

  test('createStaff validates input and rejects existing emails',async()=>{
    for(const data of [{name:'',email:'a@b.co',role:'staff'},{name:'A',email:'not-an-email',role:'staff'},{name:'A',email:'a@b.co',role:'customer'}])
      assert.equal(errorStatus(await call('createStaff',data,adminToken)),'INVALID_ARGUMENT');
    const before=(await db.collection('users').get()).size;
    assert.equal(errorStatus(await call('createStaff',{name:'Dup',email:'staff@example.test',role:'staff'},adminToken)),'ALREADY_EXISTS');
    assert.equal((await db.collection('users').get()).size,before);
  });

  test('setStaffActive updates both Auth and the profile',async()=>{
    assert.ok((await call('setStaffActive',{uid:'staff',active:false},adminToken)).result);
    assert.equal((await auth.getUser('staff')).disabled,true);
    assert.equal((await db.doc('users/staff').get()).data().active,false);
  });

  test('setStaffActive rejects self-changes, bad input and non-staff accounts',async()=>{
    assert.equal(errorStatus(await call('setStaffActive',{uid:'admin',active:false},adminToken)),'FAILED_PRECONDITION');
    assert.equal(errorStatus(await call('setStaffActive',{uid:'staff',active:'false'},adminToken)),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('setStaffActive',{uid:'customer',active:false},adminToken)),'NOT_FOUND');
    assert.equal((await auth.getUser('customer')).disabled,false);
  });

  test('resetStaffPassword works only for staff accounts',async()=>{
    assert.ok((await call('resetStaffPassword',{uid:'staff'},adminToken)).result.link);
    assert.equal(errorStatus(await call('resetStaffPassword',{uid:'customer'},adminToken)),'NOT_FOUND');
    assert.equal(errorStatus(await call('resetStaffPassword',{uid:''},adminToken)),'INVALID_ARGUMENT');
  });
});

describe('migratePrivateProductFields',()=>{
  test('is admin-only',async()=>{
    assert.equal(errorStatus(await call('migratePrivateProductFields',{},staffToken)),'PERMISSION_DENIED');
  });

  test('moves private fields across batches and is safe to rerun',async()=>{
    const writer=db.bulkWriter();
    for(let i=0;i<450;i++)
      writer.set(db.doc(`products/LEGACY${i}`),{name:`Legacy ${i}`,status:'active',stock:1,purchasePrice:i,minPricePcs:i+1});
    await writer.close();
    await db.doc('productPrivate/LEGACY0').set({minPriceCtn:99});

    const r=await call('migratePrivateProductFields',{},adminToken);
    assert.equal(r.result.migrated,450);
    const product=(await db.doc('products/LEGACY449').get()).data();
    assert.equal(product.purchasePrice,undefined);
    assert.equal(product.minPricePcs,undefined);
    assert.deepEqual((await db.doc('productPrivate/LEGACY449').get()).data(),{purchasePrice:449,minPricePcs:450});
    assert.deepEqual((await db.doc('productPrivate/LEGACY0').get()).data(),{purchasePrice:0,minPricePcs:1,minPriceCtn:99});

    assert.equal((await call('migratePrivateProductFields',{},adminToken)).result.migrated,0);
  });
});

describe('adjustStock',()=>{
  test('only active admins can adjust stock',async()=>{
    assert.equal(errorStatus(await call('adjustStock',{sku:'RICE5',delta:2,reason:'delivery received'},staffToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('adjustStock',{sku:'RICE5',delta:2,reason:'delivery received'},customerToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('adjustStock',{sku:'RICE5',delta:2,reason:'delivery received'},inactiveAdminToken)),'PERMISSION_DENIED');
    assert.equal(await stock('RICE5'),50);
  });

  test('adjusts stock and writes audit history atomically',async()=>{
    const r=await call('adjustStock',{sku:' rice5 ',delta:7,reason:'Supplier delivery PO-104'},adminToken);
    assert.deepEqual(r.result,{sku:'RICE5',from:50,to:57});
    assert.equal(await stock('RICE5'),57);
    const rows=(await db.collection('inventoryHistory').get()).docs.map(d=>d.data());
    assert.equal(rows.length,1);
    assert.equal(rows[0].sku,'RICE5');
    assert.equal(rows[0].from,50);
    assert.equal(rows[0].to,57);
    assert.equal(rows[0].reason,'adjustment: Supplier delivery PO-104');
    assert.equal(rows[0].changedBy,'admin');
    assert.ok(rows[0].at);
  });

  test('rejects invalid changes, missing products and negative resulting stock',async()=>{
    for(const data of [
      {sku:'RICE5',delta:0,reason:'count'},
      {sku:'RICE5',delta:1.5,reason:'count'},
      {sku:'RICE5',delta:100001,reason:'count'},
      {sku:'RICE5',delta:1,reason:''},
      {sku:'../RICE5',delta:1,reason:'count'},
      {sku:'MISSING',delta:1,reason:'count'}
    ]){
      const r=await call('adjustStock',data,adminToken);
      assert.ok(r.error,JSON.stringify(data));
    }
    assert.equal(errorStatus(await call('adjustStock',{sku:'OIL1',delta:-6,reason:'count correction'},adminToken)),'FAILED_PRECONDITION');
    assert.equal(await stock('OIL1'),5);
    assert.equal((await db.collection('inventoryHistory').get()).size,0);
  });
});

describe('receiveStock',()=>{
  test('only active admins can record supplier deliveries',async()=>{
    const data={sku:'RICE5',quantity:4,supplier:'Supplier Sdn Bhd',reference:'DN-204'};
    assert.equal(errorStatus(await call('receiveStock',data,staffToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('receiveStock',data,customerToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('receiveStock',data,inactiveAdminToken)),'PERMISSION_DENIED');
    assert.equal(await stock('RICE5'),50);
    assert.equal((await db.collection('inventoryHistory').get()).size,0);
  });

  test('receives stock and records supplier, reference and admin atomically',async()=>{
    const r=await call('receiveStock',{sku:' rice5 ',quantity:4,supplier:' Supplier Sdn Bhd ',reference:' DN-204 '},adminToken);
    assert.deepEqual(r.result,{sku:'RICE5',from:50,to:54,quantity:4,supplier:'Supplier Sdn Bhd',reference:'DN-204'});
    assert.equal(await stock('RICE5'),54);
    const rows=(await db.collection('inventoryHistory').get()).docs.map(d=>d.data());
    assert.equal(rows.length,1);
    assert.equal(rows[0].type,'supplier_receipt');
    assert.equal(rows[0].supplier,'Supplier Sdn Bhd');
    assert.equal(rows[0].reference,'DN-204');
    assert.equal(rows[0].quantity,4);
    assert.equal(rows[0].changedBy,'admin');
    assert.ok(rows[0].at);
  });

  test('rejects invalid receipt details and missing products without changing stock',async()=>{
    for(const data of [
      {sku:'RICE5',quantity:0,supplier:'Supplier',reference:'DN-1'},
      {sku:'RICE5',quantity:1.5,supplier:'Supplier',reference:'DN-1'},
      {sku:'RICE5',quantity:100001,supplier:'Supplier',reference:'DN-1'},
      {sku:'RICE5',quantity:1,supplier:'',reference:'DN-1'},
      {sku:'RICE5',quantity:1,supplier:'Supplier',reference:''},
      {sku:'../RICE5',quantity:1,supplier:'Supplier',reference:'DN-1'},
      {sku:'MISSING',quantity:1,supplier:'Supplier',reference:'DN-1'}
    ]) assert.ok((await call('receiveStock',data,adminToken)).error,JSON.stringify(data));
    assert.equal(await stock('RICE5'),50);
    assert.equal((await db.collection('inventoryHistory').get()).size,0);
  });
});

describe('reconcileStockCount',()=>{
  test('only active admins can reconcile physical counts',async()=>{
    const data={sku:'RICE5',expectedStock:50,countedStock:47,reason:'Weekly stock count'};
    assert.equal(errorStatus(await call('reconcileStockCount',data,staffToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('reconcileStockCount',data,customerToken)),'PERMISSION_DENIED');
    assert.equal(errorStatus(await call('reconcileStockCount',data,inactiveAdminToken)),'PERMISSION_DENIED');
    assert.equal(await stock('RICE5'),50);
    assert.equal((await db.collection('inventoryHistory').get()).size,0);
  });

  test('reconciles physical stock and audits variance atomically',async()=>{
    const r=await call('reconcileStockCount',{sku:' rice5 ',expectedStock:50,countedStock:47,reason:' Weekly count aisle A '},adminToken);
    assert.deepEqual(r.result,{sku:'RICE5',from:50,to:47,variance:-3});
    assert.equal(await stock('RICE5'),47);
    const rows=(await db.collection('inventoryHistory').get()).docs.map(d=>d.data());
    assert.equal(rows.length,1);
    assert.equal(rows[0].type,'stock_count');
    assert.equal(rows[0].from,50);
    assert.equal(rows[0].to,47);
    assert.equal(rows[0].variance,-3);
    assert.equal(rows[0].expectedStock,50);
    assert.equal(rows[0].countedStock,47);
    assert.equal(rows[0].reason,'stock_count: Weekly count aisle A');
    assert.equal(rows[0].changedBy,'admin');
    assert.ok(rows[0].at);
  });

  test('rejects stale counts, invalid values and missing products without changing stock',async()=>{
    await db.doc('products/RICE5').update({stock:51});
    const stale=await call('reconcileStockCount',{sku:'RICE5',expectedStock:50,countedStock:47,reason:'count'},adminToken);
    assert.equal(errorStatus(stale),'FAILED_PRECONDITION');
    for(const data of [
      {sku:'RICE5',expectedStock:-1,countedStock:47,reason:'count'},
      {sku:'RICE5',expectedStock:51,countedStock:-1,reason:'count'},
      {sku:'RICE5',expectedStock:51,countedStock:1.5,reason:'count'},
      {sku:'RICE5',expectedStock:51,countedStock:47,reason:''},
      {sku:'../RICE5',expectedStock:51,countedStock:47,reason:'count'},
      {sku:'MISSING',expectedStock:0,countedStock:0,reason:'count'}
    ]) assert.ok((await call('reconcileStockCount',data,adminToken)).error,JSON.stringify(data));
    assert.equal(await stock('RICE5'),51);
    assert.equal((await db.collection('inventoryHistory').get()).size,0);
  });
});


describe('saveSupplier',()=>{
  test('admin creates and updates supplier records with normalized fields',async()=>{
    const created=await call('saveSupplier',{name:'  Penang Wholesale  ',contactName:'  Mei  ',phone:'0123456789',email:'mei@example.com',address:'Penang',notes:'Main supplier'});
    assert.ok(created.result.supplierId);
    const saved=(await db.doc(`suppliers/${created.result.supplierId}`).get()).data();
    assert.equal(saved.name,'Penang Wholesale');
    assert.equal(saved.contactName,'Mei');
    assert.equal(saved.active,true);
    const updated=await call('saveSupplier',{supplierId:created.result.supplierId,name:'Penang Wholesale Sdn Bhd',active:false});
    assert.equal(updated.result.supplierId,created.result.supplierId);
    const changed=(await db.doc(`suppliers/${created.result.supplierId}`).get()).data();
    assert.equal(changed.name,'Penang Wholesale Sdn Bhd');
    assert.equal(changed.active,false);
    assert.equal(changed.phone,'');
  });
  test('supplier writes require active admin access',async()=>{
    const r=await call('saveSupplier',{name:'Not allowed'},staffToken);
    assert.equal(errorStatus(r),'PERMISSION_DENIED');
    const inactive=await call('saveSupplier',{name:'Not allowed'},inactiveAdminToken);
    assert.equal(errorStatus(inactive),'PERMISSION_DENIED');
  });
  test('supplier validation rejects missing name, invalid email, and malformed ID',async()=>{
    assert.equal(errorStatus(await call('saveSupplier',{name:'  '})),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('saveSupplier',{name:'Supplier',email:'not-an-email'})),'INVALID_ARGUMENT');
    assert.equal(errorStatus(await call('saveSupplier',{supplierId:'../users',name:'Supplier'})),'INVALID_ARGUMENT');
    assert.equal((await db.collection('suppliers').get()).size,0);
  });
});
