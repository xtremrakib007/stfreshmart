'use client';
import {useState,useEffect} from 'react';
import {collection,doc,setDoc,deleteDoc,getDoc,getDocs,serverTimestamp,writeBatch} from 'firebase/firestore';
import {ref,uploadBytes,getDownloadURL} from 'firebase/storage';
import {db,storage,fns} from '@/lib/firebase';
import {httpsCallable} from 'firebase/functions';
import {useStore} from '@/lib/store';
import {UNITS} from '@/lib/types';
const blank:any={sku:'',name:'',category:'Beef',description:'',unit:'KG',stock:0,retailPrice:0,promoPrice:0,staffPrice:0,purchasePrice:0,minPricePcs:0,minPriceCtn:0,priceSlabs:[],imageUrl:'',status:'active'};
export function Products(){
  const {products,role}=useStore();const [f,setF]=useState<any>(blank);const [msg,setMsg]=useState('');const [old,setOld]=useState<any>(null);
  const [uploading,setUploading]=useState(false);
  const [migrating,setMigrating]=useState(false);
  const [privatePrices,setPrivatePrices]=useState<Record<string,any>>({});
  useEffect(()=>{
    if(role!=='admin'){setPrivatePrices({});return}
    let active=true;
    getDocs(collection(db,'productPrivate')).then(s=>{
      if(active){const next:Record<string,any>={};s.docs.forEach(d=>{next[d.id]=d.data()});setPrivatePrices(next)}
    }).catch(()=>{if(active)setMsg('Could not load private product costs. Check admin permissions.')});
    return ()=>{active=false};
  },[role]);
  const k=(n:string)=>(e:any)=>setF({...f,[n]:['stock','retailPrice','promoPrice','staffPrice','purchasePrice','minPricePcs','minPriceCtn'].includes(n)?+e.target.value:e.target.value});

  const updateSlab=(idx:number,field:'minQty'|'price',val:number)=>{
    const slabs=[...(f.priceSlabs||[])];
    slabs[idx]={...slabs[idx],[field]:val};
    setF({...f,priceSlabs:slabs});
  };
  const addSlab=()=>{
    setF({...f,priceSlabs:[...(f.priceSlabs||[]),{minQty:0,price:0}]});
  };
  const removeSlab=(idx:number)=>{
    const slabs=(f.priceSlabs||[]).filter((_:any,i:number)=>i!==idx);
    setF({...f,priceSlabs:slabs});
  };

  async function edit(p:any){
    const [staffSnap,privateSnap]=await Promise.all([
      getDoc(doc(db,'staffPrices',p.id)),
      role==='admin'?getDoc(doc(db,'productPrivate',p.id)):Promise.resolve(null)
    ]);
    const sp=staffSnap.data()?.price??0;
    const privateData=privateSnap?.exists()?privateSnap.data():{};
    setF({
      ...p,
      staffPrice:sp,
      promoPrice:p.promoPrice??0,
      priceSlabs:Array.isArray(p.priceSlabs)?p.priceSlabs:[],
      purchasePrice:privateData?.purchasePrice??0,
      minPricePcs:privateData?.minPricePcs??0,
      minPriceCtn:privateData?.minPriceCtn??0
    });
    setOld({stock:p.stock,retail:p.retailPrice,staff:sp});
  }
  async function save(){
    if(!f.sku.trim()||!f.name.trim()){setMsg('SKU and name are required.');return}
    if(f.retailPrice<0||f.staffPrice<0||f.stock<0){setMsg('Prices and stock cannot be negative.');return}
    try{
      const id=f.sku.trim().toUpperCase();
      const {staffPrice,purchasePrice,minPricePcs,minPriceCtn,...publicProduct}=f;
      const cleanSlabs=(publicProduct.priceSlabs||[])
        .filter((s:any)=>Number.isFinite(Number(s.minQty))&&Number(s.minQty)>0&&Number.isFinite(Number(s.price))&&Number(s.price)>0)
        .sort((a:any,b:any)=>a.minQty-b.minQty);
      const productData={...publicProduct,priceSlabs:cleanSlabs,sku:id,status:publicProduct.status||'active'};
      // Keep the product, price records, private costs, and audit history consistent.
      // If any write fails, none of this save is committed.
      const batch=writeBatch(db);
      batch.set(doc(db,'products',id),productData);
      batch.set(doc(db,'staffPrices',id),{price:staffPrice});
      if(role==='admin'){
        batch.set(doc(db,'productPrivate',id),{
          purchasePrice:Number(purchasePrice)||0,
          minPricePcs:Number(minPricePcs)||0,
          minPriceCtn:Number(minPriceCtn)||0
        });
      }
      if(!old||old.retail!==productData.retailPrice||old.staff!==staffPrice)
        batch.set(doc(collection(db,'priceHistory')),{sku:id,retailPrice:productData.retailPrice,staffPrice,at:serverTimestamp()});
      if(!old||old.stock!==productData.stock)
        batch.set(doc(collection(db,'inventoryHistory')),{sku:id,from:old?.stock??0,to:productData.stock,reason:'manual',at:serverTimestamp()});
      await batch.commit();
      setF(blank);setOld(null);setMsg('Product saved.');
      if(role==='admin')setPrivatePrices(prev=>({...prev,[id]:{purchasePrice:Number(purchasePrice)||0,minPricePcs:Number(minPricePcs)||0,minPriceCtn:Number(minPriceCtn)||0}}));
    }catch{setMsg('Could not save. Check your connection and permissions.')}
  }
  async function upload(file:File){
    setUploading(true); setMsg('Uploading image...');
    try{
      const r=ref(storage,`products/${Date.now()}-${file.name.replace(/[^\w.-]/g,'_')}`);
      await uploadBytes(r,file);
      const url=await getDownloadURL(r);
      setF((prev:any)=>({...prev,imageUrl:url}));
      setMsg('Image uploaded! Click "Save product" to apply.');
    }catch(err:any){
      setMsg('Photo upload failed: '+(err?.message||'Images under 5 MB only.'));
    }finally{
      setUploading(false);
    }
  }
  async function migratePrivateFields(){
    if(!confirm('Move legacy product cost and minimum-price fields into the admin-only collection? This can be safely rerun.'))return;
    setMigrating(true);setMsg('Migrating private product fields...');
    try{
      const runMigration=httpsCallable(fns,'migratePrivateProductFields');
      const result=await runMigration({});
      const data=result.data as {scanned:number;migrated:number};
      setMsg(`Migration complete: scanned ${data.scanned} products; migrated ${data.migrated} products.`);
    }catch(err:any){
      setMsg('Migration failed. Do not deploy the new security rules until this is resolved.');
    }finally{setMigrating(false)}
  }

  const [search,setSearch]=useState('');

  const filteredProducts = products.filter(p=>
    (p.name + p.sku + (p.category||'')).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="grid gap-6 lg:grid-cols-12 items-start">
      {/* Frozen / Sticky Form Panel */}
      <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-2 rounded-xl border border-line bg-white p-4 shadow-sm max-h-[calc(100vh-6rem)] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 className="font-bold text-base text-ink">{old?'✏️ Edit Product':'✨ New Product'}</h2>
          {old && (
            <span className="text-xs bg-brine/10 text-brine px-2 py-0.5 rounded font-mono font-bold">
              {f.sku}
            </span>
          )}
        </div>
        {(['sku','name','description','imageUrl'] as const).map(n=><input key={n} className="inp" placeholder={n} value={f[n]} onChange={k(n)}/>)}
        <div className="space-y-1">
          <label className="lbl">Product photo</label>
          <input type="file" accept="image/*" disabled={uploading} onChange={e=>e.target.files&&upload(e.target.files[0])}/>
          {uploading && <p className="text-xs text-brine font-medium animate-pulse">Uploading photo, please wait...</p>}
          {f.imageUrl && (
            <div className="mt-2 flex items-center gap-3 rounded border border-line bg-frost p-2">
              <img src={f.imageUrl} alt="preview" className="h-14 w-14 rounded border border-line bg-white object-contain" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-ink truncate">Photo loaded</p>
                <button type="button" onClick={()=>setF({...f,imageUrl:''})} className="text-xs text-label hover:underline">Remove</button>
              </div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="lbl">Category</label>
            <input list="category-options" className="inp" placeholder="Category (e.g. FROZEN)" value={f.category} onChange={k('category')} />
            <datalist id="category-options">
              {Array.from(new Set(['FROZEN','SOFT DRINKS','RUNCHIT','DRY','FRUITS','FRESH','SPICES','COSMETICS','BEVERAGE','TOBACCO','MINYAK','Beef','Mutton','Fish','Poultry','Drinks','General',...products.map(p=>p.category)].filter(Boolean))).map(c=><option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="lbl">Unit</label>
            <input list="unit-options" className="inp" placeholder="Unit (e.g. PCS, CTN, KG)" value={f.unit} onChange={k('unit')} />
            <datalist id="unit-options">
              {Array.from(new Set([...UNITS,'PCS','CTN','BOX','PACK','BTL','CAN','TIN',...products.map(p=>p.unit)].filter(Boolean))).map(u=><option key={u} value={u} />)}
            </datalist>
          </div>
          <div><label className="lbl">Stock</label><input type="number" min={0} className="inp" value={f.stock} onChange={k('stock')}/></div>
          <div><label className="lbl">Retail Price (RM)</label><input type="number" min={0} step="0.01" className="inp" value={f.retailPrice} onChange={k('retailPrice')}/></div>
          <div><label className="lbl">🔥 Promo Price (RM) <span className="font-normal text-ink/50">0 = no promo</span></label><input type="number" min={0} step="0.01" className="inp text-red-700 font-semibold" value={f.promoPrice} onChange={k('promoPrice')}/></div>
          <div><label className="lbl">Staff Price (RM)</label><input type="number" min={0} step="0.01" className="inp" value={f.staffPrice} onChange={k('staffPrice')}/></div>
          {role==='admin' && <>
            <div><label className="lbl">Purchase Cost (RM) [Admin only]</label><input type="number" min={0} step="0.01" className="inp text-emerald-800 font-semibold" value={f.purchasePrice} onChange={k('purchasePrice')}/></div>
            <div><label className="lbl">Min Price PCS (RM) [Admin only]</label><input type="number" min={0} step="0.01" className="inp text-amber-800 font-semibold" value={f.minPricePcs} onChange={k('minPricePcs')}/></div>
            <div><label className="lbl">Min Price CTN (RM) [Admin only]</label><input type="number" min={0} step="0.01" className="inp text-indigo-800 font-semibold" value={f.minPriceCtn} onChange={k('minPriceCtn')}/></div>
          </>}
          <select className="inp self-end" value={f.status} onChange={k('status')}><option value="active">Visible</option><option value="hidden">Hidden</option></select>
        </div>

        {/* Price Slabs UI */}
        <div className="rounded border border-line bg-frost/50 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="lbl mb-0 font-bold text-xs">📊 Price Slabs / Wholesale</label>
            <button type="button" onClick={addSlab} className="text-xs btn-alt py-0.5 px-2 font-semibold text-brine border-brine/40 hover:bg-brine/10">+ Add</button>
          </div>
          {(!f.priceSlabs || f.priceSlabs.length===0) ? (
            <p className="text-[11px] text-ink/40 italic">No slabs. Click "+ Add" to add quantity tiers.</p>
          ) : (
            <div className="space-y-1.5">
              {f.priceSlabs.map((s:any,idx:number)=>(
                <div key={idx} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink/70 w-12">T{idx+1}:</span>
                  <input
                    type="number"
                    min={1}
                    className="inp text-xs py-1 w-20"
                    placeholder="Min"
                    value={s.minQty||''}
                    onChange={e=>updateSlab(idx,'minQty',+e.target.value)}
                  />
                  <span className="text-[11px] text-ink/60">@ RM</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="inp text-xs py-1 flex-1 font-semibold text-brine"
                    placeholder="Price"
                    value={s.price||''}
                    onChange={e=>updateSlab(idx,'price',+e.target.value)}
                  />
                  <button type="button" onClick={()=>removeSlab(idx)} className="text-xs text-label hover:underline px-1">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button className="btn flex-1" disabled={uploading} onClick={save}>{uploading?'Uploading...':'Save product'}</button>
          {old&&<button className="btn-alt" onClick={()=>{setF(blank);setOld(null)}}>Cancel</button>}
        </div>
        {role==='admin'&&<button type="button" className="btn-alt w-full text-xs" disabled={migrating} onClick={migratePrivateFields}>{migrating?'Migrating private fields...':'🔐 Migrate legacy private price fields'}</button>}
        {msg&&<p role="status" className="text-xs font-medium text-brine">{msg}</p>}
      </div>

      {/* Scrollable Products List with Search */}
      <div className="lg:col-span-7 space-y-3">
        <div className="sticky top-20 z-10 bg-frost/95 pb-2 backdrop-blur">
          <div className="relative">
            <input
              type="text"
              className="inp pl-8"
              placeholder="Search products by name, SKU, or category..."
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
            <span className="absolute left-2.5 top-2.5 text-xs text-ink/40">🔍</span>
            {search && (
              <button
                type="button"
                onClick={()=>setSearch('')}
                className="absolute right-2.5 top-2.5 text-xs text-ink/50 hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-ink/60 px-1">
            <span>Showing <strong>{filteredProducts.length}</strong> of {products.length} products</span>
            {search && <span>Filtered by &quot;{search}&quot;</span>}
          </div>
        </div>

        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto rounded-xl border border-line bg-white shadow-sm divide-y divide-line">
          {filteredProducts.length===0 ? (
            <p className="p-8 text-center text-sm text-ink/50">No products match your search.</p>
          ) : (
            filteredProducts.map(p=>(
              <div key={p.id} className="flex items-center gap-3 p-3 text-sm hover:bg-frost/40 transition-colors">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded border border-line bg-white object-contain p-0.5" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-frost text-base">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate">
                    <span className="font-semibold">{p.sku}</span> · {p.name} · <span className="text-ink/70">{p.stock} {p.unit}</span>
                    {p.status==='hidden'&&<span className="text-xs text-label font-medium ml-1">(hidden)</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5 text-xs mt-1">
                    <span className="font-semibold text-ink">Retail: RM{p.retailPrice?.toFixed(2)}</span>
                    {p.promoPrice ? <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded font-medium border border-red-200">🔥 Promo: RM{p.promoPrice.toFixed(2)}</span> : null}
                    {Array.isArray(p.priceSlabs) && p.priceSlabs.length>0 && (
                      <span className="bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded font-medium border border-blue-200" title={p.priceSlabs.map(s=>`≥${s.minQty}: RM${s.price.toFixed(2)}`).join(' | ')}>
                        📊 {p.priceSlabs.length} Slabs (from RM{Math.min(...p.priceSlabs.map(s=>s.price)).toFixed(2)})
                      </span>
                    )}
                    {role==='admin' && privatePrices[p.id]?.purchasePrice ? <span className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded font-medium border border-emerald-200">Cost: RM{privatePrices[p.id].purchasePrice.toFixed(2)}</span> : null}
                    {role==='admin' && privatePrices[p.id]?.minPricePcs ? <span className="bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded font-medium border border-amber-200">Min PCS: RM{privatePrices[p.id].minPricePcs.toFixed(2)}</span> : null}
                    {role==='admin' && privatePrices[p.id]?.minPriceCtn ? <span className="bg-indigo-50 text-indigo-800 px-1.5 py-0.5 rounded font-medium border border-indigo-200">Min CTN: RM{privatePrices[p.id].minPriceCtn.toFixed(2)}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={()=>edit(p)} className="text-xs font-semibold btn-alt py-1 px-2.5">Edit</button>
                  {role==='admin' && (
                    <button onClick={()=>confirm('Delete this product?')&&deleteDoc(doc(db,'products',p.id))} className="text-xs text-label hover:underline p-1">Delete</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
