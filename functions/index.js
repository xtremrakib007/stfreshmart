const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {FieldValue}=require('firebase-admin/firestore');
const crypto=require('crypto');
admin.initializeApp();
const opt={region:'asia-southeast1'};
const db=admin.firestore();

async function guard(req){
  if(!req.auth)throw new HttpsError('unauthenticated','Log in first.');
  const s=await db.doc(`users/${req.auth.uid}`).get();
  if(!s.exists||s.data().role!=='admin'||!s.data().active)throw new HttpsError('permission-denied','Admins only.');
}
exports.createStaff=onCall(opt,async req=>{await guard(req);
  const {name,email,phone='',role}=req.data||{};
  if(typeof name!=='string'||!name.trim()||name.trim().length>100)
    throw new HttpsError('invalid-argument','Name must be 1–100 characters.');
  if(typeof email!=='string'||email.trim().length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    throw new HttpsError('invalid-argument','A valid email address is required.');
  if(typeof phone!=='string'||phone.length>30)
    throw new HttpsError('invalid-argument','Phone must be a text value up to 30 characters.');
  if(!['staff','admin'].includes(role))
    throw new HttpsError('invalid-argument','A valid staff role is required.');
  const cleanName=name.trim();
  const cleanEmail=email.trim().toLowerCase();
  const cleanPhone=phone.trim();
  let u;
  try{
    u=await admin.auth().createUser({email:cleanEmail,displayName:cleanName,password:crypto.randomBytes(32).toString('base64url')});
    await db.doc(`users/${u.uid}`).create({name:cleanName,email:cleanEmail,phone:cleanPhone,role,active:true,createdAt:FieldValue.serverTimestamp()});
    const link=await admin.auth().generatePasswordResetLink(cleanEmail);
    return {uid:u.uid,link};
  }catch(e){
    if(u){
      try{await db.doc(`users/${u.uid}`).delete();}catch(cleanupError){console.error('Failed to clean up staff profile after creation failure.',cleanupError);}
      try{await admin.auth().deleteUser(u.uid);}catch(cleanupError){console.error('Failed to clean up Auth account after creation failure.',cleanupError);}
    }
    if(e instanceof HttpsError)throw e;
    if(e.code==='auth/email-already-exists')
      throw new HttpsError('already-exists','An account with this email already exists.');
    console.error('Staff account creation failed.',e);
    throw new HttpsError('internal','Could not create the staff account. Please retry.');
  }
});
exports.setStaffActive=onCall(opt,async req=>{await guard(req);
  const {uid,active}=req.data||{};
  if(typeof uid!=='string'||!uid.trim()||uid.length>128)throw new HttpsError('invalid-argument','A valid staff user ID is required.');
  if(typeof active!=='boolean')throw new HttpsError('invalid-argument','Active status must be true or false.');
  const targetUid=uid.trim();
  if(targetUid===req.auth.uid)throw new HttpsError('failed-precondition','You cannot change your own account status.');
  const userRef=db.doc(`users/${targetUid}`);
  const userSnap=await userRef.get();
  if(!userSnap.exists||!['staff','admin'].includes(userSnap.data().role))
    throw new HttpsError('not-found','Staff account not found.');
  let authUser;
  try{authUser=await admin.auth().getUser(targetUid);}
  catch(e){if(e.code==='auth/user-not-found')throw new HttpsError('not-found','Staff authentication account not found.');throw e;}
  const previousDisabled=authUser.disabled===true;
  await admin.auth().updateUser(targetUid,{disabled:!active});
  try{
    await userRef.update({active});
  }catch(e){
    try{await admin.auth().updateUser(targetUid,{disabled:previousDisabled});}
    catch(rollbackError){console.error('Failed to roll back staff Auth status after Firestore update failure.',rollbackError);}
    throw new HttpsError('internal','Could not update staff status. Please retry or verify the account status.');
  }
  return {ok:true};
});
exports.resetStaffPassword=onCall(opt,async req=>{await guard(req);
  const data=req.data||{};
  if(typeof data.uid!=='string'||!data.uid.trim()||data.uid.trim().length>128)
    throw new HttpsError('invalid-argument','A valid staff user ID is required.');
  const uid=data.uid.trim();
  const profile=await db.doc(`users/${uid}`).get();
  if(!profile.exists||!['staff','admin'].includes(profile.data().role))
    throw new HttpsError('not-found','Staff account not found.');
  let user;
  try{user=await admin.auth().getUser(uid);}
  catch(e){if(e.code==='auth/user-not-found')throw new HttpsError('not-found','Staff authentication account not found.');throw e;}
  if(!user.email)throw new HttpsError('failed-precondition','This staff account has no email address for password recovery.');
  try{return {link:await admin.auth().generatePasswordResetLink(user.email)};}
  catch(e){console.error('Staff password reset link generation failed.',e);throw new HttpsError('internal','Could not generate a password reset link.');}
});
// All customer order prices are recalculated here. The browser submits only product IDs and quantities.
exports.createOrder=onCall({...opt, enforceAppCheck:false},async req=>{
  const data=req.data||{};
  const requestId=data.requestId;
  if(typeof requestId!=='string'||! /^[A-Za-z0-9_-]{16,128}$/.test(requestId))
    throw new HttpsError('invalid-argument','A valid checkout request ID is required.');
  const customer=data.customer||{};
  const method=data.method;
  const delivery=data.delivery||{};
  const requested=data.items;
  if(!['STANDARD DELIVERY','URGENT DELIVERY','SELF PICKUP'].includes(method))
    throw new HttpsError('invalid-argument','Invalid delivery method.');
  if(typeof customer.name!=='string'||!customer.name.trim()||customer.name.trim().length>120||
     typeof customer.phone!=='string'||!customer.phone.trim()||customer.phone.trim().length>40||
     typeof (customer.company||'')!=='string'||(customer.company||'').length>160)
    throw new HttpsError('invalid-argument','Valid customer name and phone are required.');
  if(!requested||typeof requested!=='object'||Array.isArray(requested)||Object.keys(requested).length<1||Object.keys(requested).length>100)
    throw new HttpsError('invalid-argument','Choose between 1 and 100 products.');
  for(const key of ['address','city','state','postcode','date','time','collector','collectorPhone','vehicle','instructions','notes','reason']){
    if(delivery[key]!==undefined&&(typeof delivery[key]!=='string'||delivery[key].length>500))
      throw new HttpsError('invalid-argument','Invalid delivery details.');
  }
  if(method==='SELF PICKUP'&&(!delivery.date||!delivery.time||!delivery.collector))
    throw new HttpsError('invalid-argument','Pickup date, time and collector are required.');
  if(method!=='SELF PICKUP'&&(!delivery.address||!delivery.city||!delivery.state||!delivery.postcode))
    throw new HttpsError('invalid-argument','Delivery address details are required.');
  if(method==='STANDARD DELIVERY'&&!delivery.date)
    throw new HttpsError('invalid-argument','Delivery date is required.');
  if(method==='URGENT DELIVERY'&&(!delivery.date||!delivery.time||!delivery.reason))
    throw new HttpsError('invalid-argument','Urgent date, time and reason are required.');

  // Validate request shape and resolve idempotency before checking live stock/prices.
  // A legitimate retry must still return the original order after stock or catalog changes.
  const normalizedSkus=new Set();
  for(const [sku,qty] of Object.entries(requested)){
    if(typeof sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(sku))
      throw new HttpsError('invalid-argument','Invalid product SKU.');
    const normalized=sku.toUpperCase();
    if(normalizedSkus.has(normalized))
      throw new HttpsError('invalid-argument','Duplicate product SKU keys are not allowed.');
    normalizedSkus.add(normalized);
    if(typeof qty!=='number'||!Number.isSafeInteger(qty)||qty<1||qty>100000)
      throw new HttpsError('invalid-argument',`Invalid quantity for ${sku}.`);
  }
  const cleanDelivery={};
  for(const key of ['name','phone','company','address','city','state','postcode','date','time','collector','collectorPhone','vehicle','instructions','notes','reason'])
    if(typeof delivery[key]==='string')cleanDelivery[key]=delivery[key].trim().slice(0,500);
  const normalizedCustomer={name:customer.name.trim(),phone:customer.phone.trim(),company:(customer.company||'').trim()};
  const requestScope=req.auth?req.auth.uid:'guest';
  const requestKey=crypto.createHash('sha256').update(requestScope+'\\0'+requestId).digest('hex');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    customer:normalizedCustomer,method,delivery:cleanDelivery,
    items:Object.entries(requested).map(([sku,qty])=>({sku:sku.toUpperCase(),qty})).sort((a,b)=>a.sku.localeCompare(b.sku))
  })).digest('hex');
  const requestRef=db.doc(`checkoutRequests/${requestKey}`);
  const priorRequest=await requestRef.get();
  if(priorRequest.exists){
    const saved=priorRequest.data();
    if(saved.fingerprint!==fingerprint)
      throw new HttpsError('failed-precondition','This checkout request ID was already used with different order details. Start a new checkout attempt.');
    const priorOrder=await db.doc(`orders/${saved.orderId}`).get();
    if(!priorOrder.exists)
      throw new HttpsError('failed-precondition','The original order record is unavailable. Contact support before retrying.');
    const existing=priorOrder.data();
    return {orderId:saved.orderId,lines:existing.items,total:existing.total,currency:existing.currency||'RM',message:existing.message};
  }

  let role='customer';
  if(req.auth){
    const userSnap=await db.doc(`users/${req.auth.uid}`).get();
    if(userSnap.exists&&userSnap.data().active===true&&['staff','admin'].includes(userSnap.data().role))
      role=userSnap.data().role;
  }
  const lines=[];
  for(const [sku,rawQty] of Object.entries(requested)){
    if(typeof sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(sku)) throw new HttpsError('invalid-argument','Invalid product SKU.');
    const qty=rawQty;
    if(typeof qty!=='number'||!Number.isSafeInteger(qty)||qty<1||qty>100000)
      throw new HttpsError('invalid-argument',`Invalid quantity for ${sku}.`);
    const productSnap=await db.doc(`products/${String(sku).toUpperCase()}`).get();
    if(!productSnap.exists)throw new HttpsError('failed-precondition',`Product ${sku} is unavailable.`);
    const p=productSnap.data();
    if(role==='customer'&&p.status!=='active')
      throw new HttpsError('failed-precondition',`Product ${sku} is unavailable.`);
    const stock=Number(p.stock);
    if(!Number.isFinite(stock)||stock<qty)
      throw new HttpsError('failed-precondition',`Insufficient stock for ${p.name||sku}.`);
    let unitPrice=Number(p.retailPrice);
    let hasStaffPrice=false;
    if(role!=='customer'){
      const staffSnap=await db.doc(`staffPrices/${productSnap.id}`).get();
      if(staffSnap.exists&&Number.isFinite(Number(staffSnap.data().price))){
        unitPrice=Number(staffSnap.data().price);
        hasStaffPrice=true;
      }
    }
    if(!hasStaffPrice){
      const slabs=Array.isArray(p.priceSlabs)?p.priceSlabs.filter(s=>Number(s.minQty)>0&&Number(s.price)>0).sort((a,b)=>Number(b.minQty)-Number(a.minQty)):[];
      const slab=slabs.find(s=>qty>=Number(s.minQty));
      if(slab)unitPrice=Number(slab.price);
      else if(Number(p.promoPrice)>0)unitPrice=Number(p.promoPrice);
    }
    if(!Number.isFinite(unitPrice)||unitPrice<0)
      throw new HttpsError('failed-precondition',`Price is not configured for ${p.name||sku}.`);
    lines.push({sku:productSnap.id,name:String(p.name||sku).slice(0,200),unit:String(p.unit||'PCS').slice(0,30),qty,price:unitPrice});
  }
  const total=lines.reduce((sum,line)=>sum+line.qty*line.price,0);
  if(!Number.isFinite(total)||total>10000000)throw new HttpsError('failed-precondition','Order total is outside the allowed range.');
  const currencySnap=await db.doc('settings/main').get();
  const currency=currencySnap.exists&&typeof currencySnap.data().currency==='string'?currencySnap.data().currency:'RM';
  const message=[
    method==='URGENT DELIVERY'?'URGENT ORDER':'NEW ORDER REQUEST',
    `Customer: ${customer.name.trim()}`,
    `Phone: ${customer.phone.trim()}`,
    customer.company? `Company: ${customer.company.trim()}`:'',
    `Delivery: ${method}`,
    method==='SELF PICKUP'? `Collector: ${cleanDelivery.collector||''}` : `Address: ${[cleanDelivery.address,cleanDelivery.city,cleanDelivery.state,cleanDelivery.postcode].filter(Boolean).join(', ')}`,
    `When: ${[cleanDelivery.date,cleanDelivery.time].filter(Boolean).join(' ')}`,
    'Items:',
    ...lines.map(l=>`${l.name} x ${l.qty} ${l.unit} @ ${currency}${l.price.toFixed(2)}`),
    `Verified total: ${currency}${total.toFixed(2)}`,
    cleanDelivery.instructions||cleanDelivery.notes||''
  ].filter(Boolean).join('\n');
  const order={customer:normalizedCustomer,method,delivery:cleanDelivery,items:lines,total,currency,status:'Pending',placedBy:role,message,createdAt:FieldValue.serverTimestamp()};
  // A stable request ID makes client retries safe. Scope keys to the authenticated user
  // (or the guest namespace) and bind each key to the validated request payload.
  const ref=db.collection('orders').doc();
  const result=await db.runTransaction(async tx=>{
    const prior=await tx.get(requestRef);
    if(prior.exists){
      const saved=prior.data();
      if(saved.fingerprint!==fingerprint)
        throw new HttpsError('failed-precondition','This checkout request ID was already used with different order details. Start a new checkout attempt.');
      const priorOrder=await tx.get(db.doc(`orders/${saved.orderId}`));
      if(!priorOrder.exists)
        throw new HttpsError('failed-precondition','The original order record is unavailable. Contact support before retrying.');
      const existing=priorOrder.data();
      return {orderId:saved.orderId,lines:existing.items,total:existing.total,currency:existing.currency||currency,message:existing.message};
    }
    tx.create(ref,order);
    tx.create(requestRef,{fingerprint,orderId:ref.id,createdAt:FieldValue.serverTimestamp()});
    return {orderId:ref.id,lines,total,currency,message};
  });
  return result;
});


// One-time admin migration: move legacy private pricing fields out of readable product documents.
// Safe to rerun; existing private values are merged before legacy fields are deleted.
exports.migratePrivateProductFields=onCall(opt,async req=>{
  await guard(req);
  const snap=await db.collection('products').get();
  let migrated=0;
  for(let start=0;start<snap.docs.length;start+=200){
    // Each migrated product can require two writes; stay below Firestore's 500-write batch limit.
    const docs=snap.docs.slice(start,start+200);
    const batch=db.batch();
    for(const product of docs){
      const p=product.data();
      const privateData={};
      for(const key of ['purchasePrice','minPricePcs','minPriceCtn']){
        if(Object.prototype.hasOwnProperty.call(p,key)&&p[key]!==undefined)privateData[key]=p[key];
      }
      if(Object.keys(privateData).length){
        batch.set(db.doc(`productPrivate/${product.id}`),privateData,{merge:true});
        const remove={};
        for(const key of Object.keys(privateData))remove[key]=FieldValue.delete();
        batch.update(product.ref,remove);
        migrated++;
      }
    }
    await batch.commit();
  }
  return {scanned:snap.size,migrated,message:'Private product fields migrated and removed from public product documents.'};
});

// Admin-only stock adjustment. The stock mutation and audit record commit atomically.
exports.adjustStock=onCall(opt,async req=>{
  await guard(req);
  const data=req.data||{};
  if(typeof data.sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(data.sku.trim()))
    throw new HttpsError('invalid-argument','A valid product SKU is required.');
  if(typeof data.delta!=='number'||!Number.isSafeInteger(data.delta)||data.delta===0||Math.abs(data.delta)>100000)
    throw new HttpsError('invalid-argument','Stock change must be a non-zero whole number within 100000 units.');
  if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.trim().length>200)
    throw new HttpsError('invalid-argument','A reason of 1–200 characters is required.');
  const sku=data.sku.trim().toUpperCase();
  const productRef=db.doc(`products/${sku}`);
  let result;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(productRef);
    if(!snap.exists)throw new HttpsError('not-found','Product not found.');
    const current=Number(snap.data().stock);
    const next=current+data.delta;
    if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(next)||next<0)
      throw new HttpsError('failed-precondition','This adjustment would create invalid or negative stock.');
    tx.update(productRef,{stock:next});
    tx.set(db.collection('inventoryHistory').doc(),{
      sku,from:current,to:next,reason:`adjustment: ${data.reason.trim()}`,
      at:FieldValue.serverTimestamp(),changedBy:req.auth.uid
    });
    result={sku,from:current,to:next};
  });
  return result;
});

// Record a supplier delivery with a required reference and atomic stock/audit update.
exports.receiveStock=onCall(opt,async req=>{
  await guard(req);
  const data=req.data||{};
  if(typeof data.sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(data.sku.trim()))
    throw new HttpsError('invalid-argument','A valid product SKU is required.');
  if(typeof data.quantity!=='number'||!Number.isSafeInteger(data.quantity)||data.quantity<1||data.quantity>100000)
    throw new HttpsError('invalid-argument','Received quantity must be a whole number from 1 to 100000.');
  if(typeof data.supplier!=='string'||!data.supplier.trim()||data.supplier.trim().length>120)
    throw new HttpsError('invalid-argument','Supplier name is required (up to 120 characters).');
  if(typeof data.reference!=='string'||!data.reference.trim()||data.reference.trim().length>80)
    throw new HttpsError('invalid-argument','Delivery note or invoice reference is required (up to 80 characters).');
  const sku=data.sku.trim().toUpperCase();
  const supplier=data.supplier.trim(), reference=data.reference.trim();
  const productRef=db.doc(`products/${sku}`);
  let result;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(productRef);
    if(!snap.exists)throw new HttpsError('not-found','Product not found.');
    const current=Number(snap.data().stock), next=current+data.quantity;
    if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(next)||next<0||next>Number.MAX_SAFE_INTEGER)
      throw new HttpsError('failed-precondition','Received stock would create an invalid stock balance.');
    tx.update(productRef,{stock:next});
    tx.set(db.collection('inventoryHistory').doc(),{
      sku,from:current,to:next,reason:`receipt: ${supplier} | reference: ${reference} | quantity: ${data.quantity}`,
      type:'supplier_receipt',supplier,reference,quantity:data.quantity,
      at:FieldValue.serverTimestamp(),changedBy:req.auth.uid
    });
    result={sku,from:current,to:next,quantity:data.quantity,supplier,reference};
  });
  return result;
});

// Reconcile a physical stock count only if the system balance has not changed since it was observed.
exports.reconcileStockCount=onCall(opt,async req=>{
  await guard(req);
  const data=req.data||{};
  if(typeof data.sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(data.sku.trim()))
    throw new HttpsError('invalid-argument','A valid product SKU is required.');
  if(typeof data.expectedStock!=='number'||!Number.isSafeInteger(data.expectedStock)||data.expectedStock<0)
    throw new HttpsError('invalid-argument','Expected stock must be a non-negative whole number.');
  if(typeof data.countedStock!=='number'||!Number.isSafeInteger(data.countedStock)||data.countedStock<0||data.countedStock>Number.MAX_SAFE_INTEGER)
    throw new HttpsError('invalid-argument','Counted stock must be a non-negative whole number.');
  if(typeof data.reason!=='string'||!data.reason.trim()||data.reason.trim().length>200)
    throw new HttpsError('invalid-argument','A reason of 1–200 characters is required.');
  const sku=data.sku.trim().toUpperCase(), reason=data.reason.trim();
  const productRef=db.doc(`products/${sku}`);
  let result;
  await db.runTransaction(async tx=>{
    const snap=await tx.get(productRef);
    if(!snap.exists)throw new HttpsError('not-found','Product not found.');
    const current=Number(snap.data().stock);
    if(!Number.isSafeInteger(current)||current<0)
      throw new HttpsError('failed-precondition','Current system stock is invalid.');
    if(current!==data.expectedStock)
      throw new HttpsError('failed-precondition','Stock changed since this count was started. Refresh the product list and count again.');
    const variance=data.countedStock-current;
    tx.update(productRef,{stock:data.countedStock});
    tx.set(db.collection('inventoryHistory').doc(),{
      sku,from:current,to:data.countedStock,variance,reason:`stock_count: ${reason}`,
      type:'stock_count',expectedStock:current,countedStock:data.countedStock,
      at:FieldValue.serverTimestamp(),changedBy:req.auth.uid
    });
    result={sku,from:current,to:data.countedStock,variance};
  });
  return result;
});

// Trusted order workflow: clients cannot change order status or stock flags directly.
exports.updateOrderStatus=onCall(opt,async req=>{
  if(!req.auth)throw new HttpsError('unauthenticated','Log in first.');
  const userSnap=await db.doc(`users/${req.auth.uid}`).get();
  if(!userSnap.exists||userSnap.data().active!==true||!['staff','admin'].includes(userSnap.data().role))
    throw new HttpsError('permission-denied','Active staff access required.');
  const {orderId,to}=req.data||{};
  if(typeof orderId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(orderId)||typeof to!=='string')
    throw new HttpsError('invalid-argument','A valid order ID and target status are required.');
  const allowed={
    Pending:['Accepted','Cancelled'],
    Accepted:['Preparing','Cancelled'],
    Preparing:['Ready','Cancelled'],
    Ready:['Out For Delivery','Cancelled'],
    'Out For Delivery':['Delivered','Cancelled']
  };
  const orderRef=db.doc(`orders/${orderId}`);
  await db.runTransaction(async tx=>{
    const orderSnap=await tx.get(orderRef);
    if(!orderSnap.exists)throw new HttpsError('not-found','Order not found.');
    const order=orderSnap.data();
    if(!(allowed[order.status]||[]).includes(to))
      throw new HttpsError('failed-precondition','This status transition is not allowed.');
    const deduct=to==='Accepted'&&!order.stockDeducted;
    const restore=to==='Cancelled'&&order.stockDeducted===true;
    const items=Array.isArray(order.items)?order.items:[];
    if((deduct||restore)&&(!items.length||items.length>100))
      throw new HttpsError('failed-precondition','Order items are invalid.');
    // Aggregate by SKU so duplicate lines cannot overwrite each other's stock updates.
    const quantities=new Map();
    if(deduct||restore){
      for(const item of items){
        if(!item||typeof item.sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(item.sku.trim()))
          throw new HttpsError('failed-precondition','Order contains an invalid product SKU.');
        const sku=item.sku.trim().toUpperCase(),qty=Number(item.qty);
        if(!Number.isInteger(qty)||qty<1||qty>100000)
          throw new HttpsError('failed-precondition','Order contains an invalid quantity.');
        const combined=(quantities.get(sku)||0)+qty;
        if(!Number.isSafeInteger(combined)||combined>100000)
          throw new HttpsError('failed-precondition','Combined product quantity is invalid.');
        quantities.set(sku,combined);
      }
    }
    const entries=[...quantities.entries()];
    const refs=entries.map(([sku])=>db.doc(`products/${sku}`));
    const snaps=(deduct||restore)?await Promise.all(refs.map(ref=>tx.get(ref))):[];
    const changes=[];
    if(deduct||restore){
      for(let i=0;i<snaps.length;i++){
        const snap=snaps[i],[sku,qty]=entries[i];
        if(!snap.exists)
          throw new HttpsError('failed-precondition',`Order product ${sku} no longer exists.`);
        const stock=Number(snap.data().stock);
        const nextStock=stock+(deduct?-qty:qty);
        if(!Number.isFinite(stock)||stock<0||(deduct&&stock<qty)||!Number.isFinite(nextStock)||nextStock<0)
          throw new HttpsError('failed-precondition',`Insufficient or invalid stock for ${snap.data().name||sku}.`);
        changes.push({ref:snap.ref,sku,from:stock,to:nextStock});
      }
    }
    for(const c of changes){
      tx.update(c.ref,{stock:c.to});
      tx.set(db.collection('inventoryHistory').doc(),{
        sku:c.sku,from:c.from,to:c.to,reason:deduct?`order ${orderId}`:`cancel ${orderId}`,
        at:FieldValue.serverTimestamp(),changedBy:req.auth.uid
      });
    }
    tx.update(orderRef,{status:to,...(deduct?{stockDeducted:true}:{}),...(restore?{stockDeducted:false}:{})});
  });
  return {ok:true,status:to};
});


// Supplier directory writes are server-validated; supplier records are never public.
exports.saveSupplier=onCall(opt,async req=>{
  await guard(req);
  const data=req.data||{};
  const fields=['name','contactName','phone','email','address','notes'];
  const limits={name:160,contactName:120,phone:40,email:254,address:500,notes:2000};
  const clean={};
  for(const field of fields){
    const value=data[field]===undefined?'':data[field];
    if(typeof value!=='string'||value.length>limits[field])
      throw new HttpsError('invalid-argument',`Supplier ${field} must be text up to ${limits[field]} characters.`);
    clean[field]=value.trim();
  }
  if(!clean.name)throw new HttpsError('invalid-argument','Supplier name is required.');
  if(clean.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email))
    throw new HttpsError('invalid-argument','Enter a valid supplier email address.');
  if(data.active!==undefined&&typeof data.active!=='boolean')
    throw new HttpsError('invalid-argument','Supplier active status must be true or false.');
  const supplierId=data.supplierId===undefined?'':data.supplierId;
  if(supplierId!==''&&(typeof supplierId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(supplierId)))
    throw new HttpsError('invalid-argument','Supplier ID is invalid.');
  const ref=supplierId?db.doc(`suppliers/${supplierId}`):db.collection('suppliers').doc();
  const previous=supplierId?await ref.get():null;
  if(supplierId&&!previous.exists)throw new HttpsError('not-found','Supplier not found.');
  const active=data.active===undefined?(previous?previous.data().active!==false:true):data.active;
  const record={...clean,active,updatedAt:FieldValue.serverTimestamp(),updatedBy:req.auth.uid};
  if(!previous)record.createdAt=FieldValue.serverTimestamp();
  await ref.set(record,{merge:true});
  return {supplierId:ref.id,ok:true};
});
