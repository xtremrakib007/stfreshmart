'use strict';
const {test,before,beforeEach,after,describe}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc,deleteDoc,addDoc,collection,serverTimestamp,setLogLevel}=require('firebase/firestore');

// Denied writes are expected here; keep the SDK from logging each one.
setLogLevel('silent');
const {ref,uploadBytes,getBytes}=require('firebase/storage');
const {PROJECT_ID}=require('./helpers');

const root=path.join(__dirname,'..');
let env;

before(async()=>{
  env=await initializeTestEnvironment({
    projectId:PROJECT_ID,
    firestore:{rules:fs.readFileSync(path.join(root,'firestore.rules'),'utf8')},
    storage:{rules:fs.readFileSync(path.join(root,'storage.rules'),'utf8'),host:'127.0.0.1',port:9199}
  });
});
after(()=>env.cleanup());

beforeEach(async()=>{
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx=>{
    const d=ctx.firestore();
    await setDoc(doc(d,'users/admin'),{role:'admin',active:true});
    await setDoc(doc(d,'users/inactiveAdmin'),{role:'admin',active:false});
    await setDoc(doc(d,'users/staff'),{role:'staff',active:true});
    await setDoc(doc(d,'users/inactiveStaff'),{role:'staff',active:false});
    await setDoc(doc(d,'products/ACTIVE1'),{name:'Active',status:'active',retailPrice:10,stock:5});
    await setDoc(doc(d,'products/HIDDEN1'),{name:'Hidden',status:'inactive',retailPrice:10,stock:5});
    await setDoc(doc(d,'productPrivate/ACTIVE1'),{purchasePrice:4});
    await setDoc(doc(d,'staffPrices/ACTIVE1'),{price:8});
    await setDoc(doc(d,'orders/order1'),{status:'Pending',total:10});
    await setDoc(doc(d,'inventoryHistory/h1'),{sku:'ACTIVE1',from:5,to:4,reason:'manual'});
    await setDoc(doc(d,'settings/main'),{currency:'RM'});
  });
});

const guest=()=>env.unauthenticatedContext().firestore();
const as=uid=>env.authenticatedContext(uid).firestore();
// Signed in but without a users/{uid} profile, as a customer account would be.
const customer=()=>as('customer');

describe('products',()=>{
  test('anyone can read active products',async()=>{
    await assertSucceeds(getDoc(doc(guest(),'products/ACTIVE1')));
  });
  test('guests and customers cannot read inactive products',async()=>{
    await assertFails(getDoc(doc(guest(),'products/HIDDEN1')));
    await assertFails(getDoc(doc(customer(),'products/HIDDEN1')));
  });
  test('active staff can read inactive products, inactive staff cannot',async()=>{
    await assertSucceeds(getDoc(doc(as('staff'),'products/HIDDEN1')));
    await assertFails(getDoc(doc(as('inactiveStaff'),'products/HIDDEN1')));
  });
  test('only active admins can write products',async()=>{
    await assertSucceeds(setDoc(doc(as('admin'),'products/NEW1'),{name:'New',status:'active',retailPrice:1,stock:1}));
    await assertFails(setDoc(doc(as('staff'),'products/NEW2'),{name:'New',status:'active'}));
    await assertFails(setDoc(doc(as('inactiveAdmin'),'products/NEW3'),{name:'New',status:'active'}));
    await assertFails(updateDoc(doc(customer(),'products/ACTIVE1'),{retailPrice:0}));
    await assertFails(deleteDoc(doc(as('staff'),'products/ACTIVE1')));
  });
  test('private cost fields cannot be stored on product documents',async()=>{
    for(const key of ['purchasePrice','minPricePcs','minPriceCtn']){
      await assertFails(setDoc(doc(as('admin'),'products/NEW1'),{name:'New',status:'active',[key]:1}));
      await assertFails(updateDoc(doc(as('admin'),'products/ACTIVE1'),{[key]:1}));
    }
  });
});

describe('productPrivate',()=>{
  test('only active admins can read or write private costs',async()=>{
    await assertSucceeds(getDoc(doc(as('admin'),'productPrivate/ACTIVE1')));
    await assertSucceeds(setDoc(doc(as('admin'),'productPrivate/ACTIVE1'),{purchasePrice:5}));
    await assertFails(getDoc(doc(as('staff'),'productPrivate/ACTIVE1')));
    await assertFails(getDoc(doc(as('inactiveAdmin'),'productPrivate/ACTIVE1')));
    await assertFails(getDoc(doc(customer(),'productPrivate/ACTIVE1')));
    await assertFails(getDoc(doc(guest(),'productPrivate/ACTIVE1')));
  });
});

describe('staffPrices',()=>{
  test('active staff can read staff prices',async()=>{
    await assertSucceeds(getDoc(doc(as('staff'),'staffPrices/ACTIVE1')));
    await assertSucceeds(getDoc(doc(as('admin'),'staffPrices/ACTIVE1')));
  });
  test('customers, guests and inactive staff cannot read staff prices',async()=>{
    await assertFails(getDoc(doc(guest(),'staffPrices/ACTIVE1')));
    await assertFails(getDoc(doc(customer(),'staffPrices/ACTIVE1')));
    await assertFails(getDoc(doc(as('inactiveStaff'),'staffPrices/ACTIVE1')));
  });
  test('only admins can write staff prices',async()=>{
    await assertSucceeds(setDoc(doc(as('admin'),'staffPrices/ACTIVE1'),{price:7}));
    await assertFails(setDoc(doc(as('staff'),'staffPrices/ACTIVE1'),{price:1}));
  });
});

describe('users',()=>{
  test('users can read their own profile, admins can read any',async()=>{
    await assertSucceeds(getDoc(doc(as('staff'),'users/staff')));
    await assertSucceeds(getDoc(doc(as('admin'),'users/staff')));
    await assertFails(getDoc(doc(as('staff'),'users/admin')));
    await assertFails(getDoc(doc(guest(),'users/staff')));
  });
  test('no client can write profiles, including role escalation',async()=>{
    await assertFails(updateDoc(doc(as('staff'),'users/staff'),{role:'admin'}));
    await assertFails(updateDoc(doc(as('inactiveStaff'),'users/inactiveStaff'),{active:true}));
    await assertFails(setDoc(doc(customer(),'users/customer'),{role:'admin',active:true}));
    await assertFails(setDoc(doc(as('admin'),'users/someone'),{role:'staff',active:true}));
  });
});

describe('orders',()=>{
  const order={customer:{name:'A',phone:'1',company:''},method:'SELF PICKUP',delivery:{},
    items:[{sku:'ACTIVE1',qty:1,price:0}],total:0,status:'Pending',placedBy:'customer',message:'x'};
  test('clients cannot create orders directly',async()=>{
    await assertFails(addDoc(collection(guest(),'orders'),{...order,createdAt:serverTimestamp()}));
    await assertFails(addDoc(collection(customer(),'orders'),{...order,createdAt:serverTimestamp()}));
    await assertFails(addDoc(collection(as('admin'),'orders'),{...order,createdAt:serverTimestamp()}));
  });
  test('clients cannot update orders directly',async()=>{
    await assertFails(updateDoc(doc(as('staff'),'orders/order1'),{status:'Accepted'}));
    await assertFails(updateDoc(doc(as('admin'),'orders/order1'),{total:0}));
  });
  test('only active staff can read orders',async()=>{
    await assertSucceeds(getDoc(doc(as('staff'),'orders/order1')));
    await assertFails(getDoc(doc(as('inactiveStaff'),'orders/order1')));
    await assertFails(getDoc(doc(customer(),'orders/order1')));
    await assertFails(getDoc(doc(guest(),'orders/order1')));
  });
  test('only admins can delete orders',async()=>{
    await assertFails(deleteDoc(doc(as('staff'),'orders/order1')));
    await assertSucceeds(deleteDoc(doc(as('admin'),'orders/order1')));
  });
});

describe('inventoryHistory',()=>{
  const manual=()=>({sku:'ACTIVE1',from:5,to:6,reason:'manual',at:serverTimestamp()});
  test('admins can record valid manual stock edits',async()=>{
    await assertSucceeds(addDoc(collection(as('admin'),'inventoryHistory'),manual()));
  });
  test('invalid or non-admin history entries are rejected',async()=>{
    await assertFails(addDoc(collection(as('staff'),'inventoryHistory'),manual()));
    await assertFails(addDoc(collection(as('admin'),'inventoryHistory'),{...manual(),reason:'order abc'}));
    await assertFails(addDoc(collection(as('admin'),'inventoryHistory'),{...manual(),to:-1}));
    await assertFails(addDoc(collection(as('admin'),'inventoryHistory'),{...manual(),changedBy:'x'}));
    await assertFails(addDoc(collection(as('admin'),'inventoryHistory'),{...manual(),at:new Date(0)}));
  });
  test('history is append-only and readable by staff only',async()=>{
    await assertFails(updateDoc(doc(as('admin'),'inventoryHistory/h1'),{to:0}));
    await assertFails(deleteDoc(doc(as('admin'),'inventoryHistory/h1')));
    await assertSucceeds(getDoc(doc(as('staff'),'inventoryHistory/h1')));
    await assertFails(getDoc(doc(guest(),'inventoryHistory/h1')));
  });
});

describe('settings',()=>{
  test('settings are public to read and admin-only to write',async()=>{
    await assertSucceeds(getDoc(doc(guest(),'settings/main')));
    await assertSucceeds(setDoc(doc(as('admin'),'settings/main'),{currency:'RM'}));
    await assertFails(setDoc(doc(as('staff'),'settings/main'),{currency:'USD'}));
  });
});

describe('storage',()=>{
  const image=new Uint8Array([137,80,78,71]);
  const storageAs=uid=>env.authenticatedContext(uid).storage();
  // firebase-tools routes Storage-to-Firestore rule lookups through HTTPS_PROXY even for
  // 127.0.0.1, so any check that calls firestore.get() fails behind a proxy.
  const proxied=!!(process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy);
  test('active admins can upload product images',{skip:proxied&&'HTTPS_PROXY is set; emulator cross-service rules cannot run behind a proxy'},async()=>{
    await assertSucceeds(uploadBytes(ref(storageAs('admin'),'products/a.png'),image,{contentType:'image/png'}));
  });
  test('staff, inactive admins and guests cannot upload',async()=>{
    await assertFails(uploadBytes(ref(storageAs('staff'),'products/a.png'),image,{contentType:'image/png'}));
    await assertFails(uploadBytes(ref(storageAs('inactiveAdmin'),'products/a.png'),image,{contentType:'image/png'}));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(),'products/a.png'),image,{contentType:'image/png'}));
  });
  test('non-images, files of 5 MB or more, and other paths are rejected',async()=>{
    await assertFails(uploadBytes(ref(storageAs('admin'),'products/a.html'),image,{contentType:'text/html'}));
    await assertFails(uploadBytes(ref(storageAs('admin'),'products/big.png'),new Uint8Array(5*1024*1024),{contentType:'image/png'}));
    await assertFails(uploadBytes(ref(storageAs('admin'),'other/a.png'),image,{contentType:'image/png'}));
  });
  test('product images are publicly readable',async()=>{
    await env.withSecurityRulesDisabled(ctx=>uploadBytes(ref(ctx.storage(),'products/a.png'),image,{contentType:'image/png'}));
    await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(),'products/a.png')));
  });
  test('files outside products are not publicly readable',async()=>{
    await env.withSecurityRulesDisabled(ctx=>uploadBytes(ref(ctx.storage(),'private/invoice.pdf'),image,{contentType:'application/pdf'}));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(),'private/invoice.pdf')));
  });
});
