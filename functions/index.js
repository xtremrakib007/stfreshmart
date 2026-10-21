const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
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
  if(!name||!email||!['staff','admin'].includes(role))throw new HttpsError('invalid-argument','Name, email and role are required.');
  const u=await admin.auth().createUser({email,displayName:name,password:crypto.randomBytes(16).toString('base64url')});
  await db.doc(`users/${u.uid}`).set({name,email,phone,role,active:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  return {uid:u.uid,link:await admin.auth().generatePasswordResetLink(email)};
});
exports.setStaffActive=onCall(opt,async req=>{await guard(req);
  const {uid,active}=req.data||{};
  if(typeof uid!=='string'||!uid.trim()||uid.length>128)throw new HttpsError('invalid-argument','A valid staff user ID is required.');
  if(typeof active!=='boolean')throw new HttpsError('invalid-argument','Active status must be true or false.');
  if(uid===req.auth.uid)throw new HttpsError('failed-precondition','You cannot disable your own account.');
  await admin.auth().updateUser(uid,{disabled:!active});await db.doc(`users/${uid}`).update({active:!!active});return {ok:true};
});
exports.resetStaffPassword=onCall(opt,async req=>{await guard(req);
  const u=await admin.auth().getUser(req.data.uid);return {link:await admin.auth().generatePasswordResetLink(u.email)};
});

// All customer order prices are recalculated here. The browser submits only product IDs and quantities.
exports.createOrder=onCall({...opt, enforceAppCheck:false},async req=>{
  const data=req.data||{};
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

  let role='customer';
  if(req.auth){
    const userSnap=await db.doc(`users/${req.auth.uid}`).get();
    if(userSnap.exists&&userSnap.data().active===true&&['staff','admin'].includes(userSnap.data().role))
      role=userSnap.data().role;
  }
  const lines=[];
  for(const [sku,rawQty] of Object.entries(requested)){
    if(typeof sku!=='string'||! /^[A-Za-z0-9._-]{1,100}$/.test(sku)) throw new HttpsError('invalid-argument','Invalid product SKU.');
    const qty=Number(rawQty);
    if(!Number.isInteger(qty)||qty<1||qty>100000)
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
  const cleanDelivery={};
  for(const key of ['name','phone','company','address','city','state','postcode','date','time','collector','collectorPhone','vehicle','instructions','notes','reason'])
    if(typeof delivery[key]==='string')cleanDelivery[key]=delivery[key].trim().slice(0,500);
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
  const order={customer:{name:customer.name.trim(),phone:customer.phone.trim(),company:(customer.company||'').trim()},method,delivery:cleanDelivery,items:lines,total,status:'Pending',placedBy:role,message,createdAt:admin.firestore.FieldValue.serverTimestamp()};
  const ref=await db.collection('orders').add(order);
  return {orderId:ref.id,lines,total,currency,message};
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
        for(const key of Object.keys(privateData))remove[key]=admin.firestore.FieldValue.delete();
        batch.update(product.ref,remove);
        migrated++;
      }
    }
    await batch.commit();
  }
  return {scanned:snap.size,migrated,message:'Private product fields migrated and removed from public product documents.'};
});

// Trusted order workflow: clients cannot change order status or stock flags directly.
exports.updateOrderStatus=onCall(opt,async req=>{
  if(!req.auth)throw new HttpsError('unauthenticated','Log in first.');
  const userSnap=await db.doc(`users/${req.auth.uid}`).get();
  if(!userSnap.exists||userSnap.data().active!==true||!['staff','admin'].includes(userSnap.data().role))
    throw new HttpsError('permission-denied','Active staff access required.');
  const {orderId,to}=req.data||{};
  if(typeof orderId!=='string'||!orderId||typeof to!=='string')
    throw new HttpsError('invalid-argument','Order and target status are required.');
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
        if(!item||typeof item.sku!=='string'||!item.sku.trim())
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
        if(!Number.isFinite(stock)||stock<0||(deduct&&stock<qty))
          throw new HttpsError('failed-precondition',`Insufficient or invalid stock for ${snap.data().name||sku}.`);
        changes.push({ref:snap.ref,sku,from:stock,to:stock+(deduct?-qty:qty)});
      }
    }
    for(const c of changes){
      tx.update(c.ref,{stock:c.to});
      tx.set(db.collection('inventoryHistory').doc(),{
        sku:c.sku,from:c.from,to:c.to,reason:deduct?`order ${orderId}`:`cancel ${orderId}`,
        at:admin.firestore.FieldValue.serverTimestamp(),changedBy:req.auth.uid
      });
    }
    tx.update(orderRef,{status:to,...(deduct?{stockDeducted:true}:{}),...(restore?{stockDeducted:false}:{})});
  });
  return {ok:true,status:to};
});
