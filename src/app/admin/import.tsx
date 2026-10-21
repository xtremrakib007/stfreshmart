'use client';
import {useState} from 'react';
import {doc,writeBatch,updateDoc} from 'firebase/firestore';
import {ref,uploadBytes,getDownloadURL,listAll} from 'firebase/storage';
import {db,storage} from '@/lib/firebase';
import {useStore} from '@/lib/store';
import {UNITS} from '@/lib/types';

export function ImportTab(){
  const {products}=useStore();
  const [rows,setRows]=useState<any[]>([]);
  const [errs,setErrs]=useState<string[]>([]);
  const [msg,setMsg]=useState('');
  const [busy,setBusy]=useState(false);

  // Bulk photo upload states
  const [photoMsg,setPhotoMsg]=useState('');
  const [photoProgress,setPhotoProgress]=useState<{done:number;total:number;current?:string}|null>(null);
  const [relinking,setRelinking]=useState(false);

  async function load(file:File){
    setMsg('');const XLSX=await import('xlsx');const wb=XLSX.read(await file.arrayBuffer());

    const e:string[]=[],seen=new Set<string>(),out:any[]=[];
    const parseNum=(v:any)=>{if(typeof v==='number')return isNaN(v)?NaN:v;if(v==null)return NaN;const s=String(v).trim().replace(/,/g,'').replace(/^[^\d.-]+/,'');return s===''?NaN:Number(s);};

    // Scan all sheets in the Excel workbook to ensure no sheets or categories are skipped
    for(const sheetName of wb.SheetNames){
      const s=wb.Sheets[sheetName];
      const grid:any[][]=XLSX.utils.sheet_to_json(s,{header:1,defval:''});
      if(!grid||grid.length===0) continue;

      let headerRowIndex=-1;
      for(let r=0;r<Math.min(grid.length,10);r++){
        const row=grid[r];
        if(Array.isArray(row)&&row.some(cell=>{
          const str=String(cell||'').trim().toUpperCase();
          return str==='SKU'||str.includes('SKU')||str==='ITEM CODE'||str==='PRODUCT CODE'||str==='BARCODE'||str==='ITEM NO';
        })){
          headerRowIndex=r;
          break;
        }
      }

      if(headerRowIndex===-1){
        if(grid[0]&&Array.isArray(grid[0])&&grid[0].some(cell=>{
          const str=String(cell||'').trim().toUpperCase();
          return str==='PRODUCT'||str==='NAME'||str==='DESCRIPTION';
        })){
          headerRowIndex=0;
        }else{
          continue; // not a product sheet, skip
        }
      }

      const rawHeaders=grid[headerRowIndex].map(h=>String(h||'').trim().toUpperCase());
      const findCol=(synonyms:string[])=>{
        return rawHeaders.findIndex(h=>synonyms.some(syn=>h===syn||h.replace(/[\s_-]+/g,'')===syn.replace(/[\s_-]+/g,'')));
      };

      const skuIdx=findCol(['SKU','ITEM CODE','PRODUCT CODE','CODE','BARCODE','ITEM NO']);
      const nameIdx=findCol(['NAME','PRODUCT NAME','DESCRIPTION','ITEM NAME','PRODUCT','TITLE','ITEM']);
      const catIdx=findCol(['CATEGORY','CAT','CATAGORY','CATEGORIES','CATAGORIES','GROUP','DEPARTMENT','DEPT','TYPE','SECTOR','KATEGORI','KAT']);
      const stockIdx=findCol(['STOCK','QTY','QUANTITY','CURRENT STOCK','BAL','BALANCE','AVAILABLE (BULK)','AVAILABLE(BULK)','ON HAND (BULK)','ONHAND(BULK)','ON HAND','AVAILABLE']);
      const unitIdx=findCol(['UNIT','UOM','PACKING','MEASURE','SATUAN']);
      const retailIdx=findCol(['RETAIL PRICE','RETAIL_PRICE','RETAIL','SELLING PRICE','PRICE','HARGA','HARGA JUAL']);
      const minPcsIdx=findCol(['MINIMUM SELLING PRICE PCS','MIN SELLING PRICE PCS','SELLING PRICE PCS','MIN PRICE PCS','MIN PCS']);
      const minCtnIdx=findCol(['MINIMUM SELLING PRICE CTN','MIN SELLING PRICE CTN','SELLING PRICE CTN','MIN PRICE CTN','MIN CTN']);
      const purchaseIdx=findCol(['PURCHASE PRICE','COST','CTN COST','PURCHASE COST','HARGA BELI','KOS']);
      const staffIdx=findCol(['STAFF PRICE','STAFF_PRICE','STAFF','HARGA STAFF']);
      const promoIdx=findCol(['PROMO PRICE','PROMO_PRICE','PROMO','PROMOTION PRICE','SALE PRICE','HARGA PROMO']);
      const imgIdx=findCol(['IMAGE_URL','IMAGE URL','IMAGE','PHOTO','PICTURE','URL']);

      // Price slab columns: SLAB_QTY_1 / SLAB_PRICE_1, SLAB1_QTY / SLAB1_PRICE, TIER1_QTY / TIER1_PRICE, etc.
      const slabCols: {qtyIdx: number; priceIdx: number}[] = [];
      for(let t=1; t<=5; t++){
        const qI = findCol([`SLAB_QTY_${t}`, `SLAB${t}_QTY`, `SLAB_${t}_QTY`, `TIER_QTY_${t}`, `TIER${t}_QTY`, `TIER_${t}_QTY`, `MIN_QTY_${t}`, `MIN_QTY${t}`, `QTY_SLAB_${t}`, `QTY_SLAB${t}`, `SLAB ${t} QTY`, `TIER ${t} QTY`]);
        const pI = findCol([`SLAB_PRICE_${t}`, `SLAB${t}_PRICE`, `SLAB_${t}_PRICE`, `TIER_PRICE_${t}`, `TIER${t}_PRICE`, `TIER_${t}_PRICE`, `PRICE_SLAB_${t}`, `PRICE_SLAB${t}`, `SLAB ${t} PRICE`, `TIER ${t} PRICE`]);
        if(qI !== -1 && pI !== -1){
          slabCols.push({qtyIdx: qI, priceIdx: pI});
        }
      }

      for(let i=headerRowIndex+1;i<grid.length;i++){
        const row=grid[i];
        if(!Array.isArray(row)||row.every(cell=>cell===''||cell==null)) continue;

        const n=i+1;
        const sku=String(skuIdx!==-1?row[skuIdx]:row[0]||'').trim().toUpperCase();
        const name=String(nameIdx!==-1?row[nameIdx]:row[1]||'').trim();

        if(!sku&&!name) continue;
        if(!sku||!name){
          e.push(`[${sheetName}] Row ${n}: SKU and NAME are required.`);
          continue;
        }

        // Unit
        let unit=String(unitIdx!==-1?row[unitIdx]:'PCS').trim().toUpperCase();
        if(!unit||!isNaN(Number(unit))) unit='PCS';
        else if(unit==='KGS') unit='KG';
        else if(unit==='PKT'||unit==='PK'||unit==='PACKET'||unit==='PACKS') unit='PACK';
        else if(unit==='BOTTLE'||unit==='BOTTLES') unit='BTL';

        // Stock
        let stock=stockIdx!==-1?parseNum(row[stockIdx]):0;
        if(isNaN(stock)||stock<0) stock=0;

        // Purchase price & minimum selling prices
        let purchasePrice=purchaseIdx!==-1?parseNum(row[purchaseIdx]):0;
        if(isNaN(purchasePrice)||purchasePrice<0) purchasePrice=0;

        let minPricePcs=minPcsIdx!==-1?parseNum(row[minPcsIdx]):0;
        if(isNaN(minPricePcs)||minPricePcs<0) minPricePcs=0;

        let minPriceCtn=minCtnIdx!==-1?parseNum(row[minCtnIdx]):0;
        if(isNaN(minPriceCtn)||minPriceCtn<0) minPriceCtn=0;

        // Retail Price: use RETAIL PRICE only. Do NOT fall back to minimum selling price or purchase price!
        let rp=retailIdx!==-1?parseNum(row[retailIdx]):NaN;
        if(isNaN(rp)||rp<0){
          rp=0;
        }

        // Staff Price: defaults to retail price if blank
        let sp=staffIdx!==-1?parseNum(row[staffIdx]):NaN;
        if(isNaN(sp)||sp<0) sp=rp;

        // Promo Price
        let promoPrice=promoIdx!==-1?parseNum(row[promoIdx]):0;
        if(isNaN(promoPrice)||promoPrice<0) promoPrice=0;

        // Price slabs from columns
        const priceSlabs: {minQty: number; price: number}[] = [];
        for(const sc of slabCols){
          const qVal = parseNum(row[sc.qtyIdx]);
          const pVal = parseNum(row[sc.priceIdx]);
          if(!isNaN(qVal) && qVal>0 && !isNaN(pVal) && pVal>0){
            priceSlabs.push({minQty: qVal, price: pVal});
          }
        }
        priceSlabs.sort((a,b)=>a.minQty-b.minQty);

        // Category from column, or fallback to descriptive sheet name
        let rawCat=String(catIdx!==-1?row[catIdx]:'').trim();
        if(!rawCat && !['SHEET','STOCK','TABLE','DATA','PRODUCTS','IMPORT'].some(ignore=>sheetName.trim().toUpperCase().startsWith(ignore))){
          rawCat=sheetName.trim();
        }
        const category=rawCat||'General';
        // Check if this product already has a photo in the database
        const existingProd = products.find(p=>p.sku.toUpperCase()===sku||p.id.toUpperCase()===sku);
        const fileImg=String(imgIdx!==-1?row[imgIdx]:'').trim();
        // Keep existing photo if Excel doesn't provide a new image URL
        const finalImg=fileImg||existingProd?.imageUrl||'';
        const hasPreservedPhoto=!fileImg && Boolean(existingProd?.imageUrl);

        if(seen.has(sku)){
          const existingIdx=out.findIndex(x=>x.sku===sku);
          if(existingIdx!==-1){
            out[existingIdx]={
              ...out[existingIdx],
              name:name||out[existingIdx].name,
              category:category!=='General'?category:out[existingIdx].category,
              stock:stock||out[existingIdx].stock,
              unit:unit||out[existingIdx].unit,
              retailPrice:rp||out[existingIdx].retailPrice,
              promoPrice:promoPrice||out[existingIdx].promoPrice,
              staffPrice:sp||out[existingIdx].staffPrice,
              priceSlabs:priceSlabs.length>0?priceSlabs:out[existingIdx].priceSlabs,
              purchasePrice:purchasePrice||out[existingIdx].purchasePrice,
              minPricePcs:minPricePcs||out[existingIdx].minPricePcs,
              minPriceCtn:minPriceCtn||out[existingIdx].minPriceCtn,
              imageUrl:finalImg||out[existingIdx].imageUrl,
              hasPreservedPhoto:hasPreservedPhoto||out[existingIdx].hasPreservedPhoto
            };
          }
          continue;
        }
        seen.add(sku);

        out.push({
          sku,
          name,
          category,
          stock,
          unit,
          retailPrice:rp,
          promoPrice,
          staffPrice:sp,
          priceSlabs:priceSlabs.length>0?priceSlabs:(existingProd?.priceSlabs||[]),
          purchasePrice,
          minPricePcs,
          minPriceCtn,
          imageUrl:finalImg,
          hasPreservedPhoto,
          isNew:!existingProd
        });
      }
    }

    if(out.length===0&&e.length===0){
      setErrs(['The selected file contains no readable product rows. Please check that your sheets have SKU and NAME columns.']);
      return;
    }

    setRows(out);setErrs(e);
  }

  async function commit(){
    setBusy(true);setMsg('');
    try{for(let i=0;i<rows.length;i+=200){const b=writeBatch(db);
      rows.slice(i,i+200).forEach(r=>{const {staffPrice,isNew,imageUrl,hasPreservedPhoto,...p}=r;
        const existingProd=products.find(prod=>prod.sku.toUpperCase()===r.sku.toUpperCase()||prod.id.toUpperCase()===r.sku.toUpperCase());
        const data:any = {
          ...p,
          description: p.description || existingProd?.description || '',
          status: existingProd?.status || 'active'
        };
        // NEVER overwrite existing product photos with empty string
        const finalPhoto = imageUrl || existingProd?.imageUrl || '';
        if(finalPhoto){
          data.imageUrl = finalPhoto;
        } else if(isNew){
          data.imageUrl = '';
        }
        b.set(doc(db,'products',r.sku),data,{merge:true});
        b.set(doc(db,'staffPrices',r.sku),{price:staffPrice});
      });
      await b.commit();}
      setMsg(`Success! Imported ${rows.length} products into catalog. Existing photos were safely preserved.`);setRows([]);
    }catch(err:any){setMsg(`Import failed: ${err?.message||'Check connection and permissions.'}`)}setBusy(false);
  }

  async function relinkExistingPhotos(){
    setRelinking(true);setPhotoMsg('Scanning Storage for previously uploaded product photos...');
    try{
      const res = await listAll(ref(storage, 'products'));
      let restored = 0;
      for (const item of res.items) {
        const withoutExt = item.name.substring(0, item.name.lastIndexOf('.')).trim().toUpperCase();
        const sku = withoutExt.replace(/^\d+[-_]/, '').trim();
        const prod = products.find(p => p.sku.toUpperCase() === sku || p.id.toUpperCase() === sku);
        if (prod) {
          const url = await getDownloadURL(item);
          await updateDoc(doc(db, 'products', prod.id), { imageUrl: url });
          restored++;
        }
      }
      setPhotoMsg(`Successfully restored and relinked ${restored} photo(s) from Storage back to your products!`);
    }catch(err:any){
      setPhotoMsg('Photo relink failed: ' + (err?.message || 'Check connection.'));
    }finally{
      setRelinking(false);
    }
  }

  async function handleBulkPhotos(files:FileList|null){
    if(!files||files.length===0) return;
    setPhotoMsg('');
    const arr=Array.from(files);
    setPhotoProgress({done:0,total:arr.length});
    let matched=0;
    let skipped=0;
    for(let i=0;i<arr.length;i++){
      const file=arr[i];
      const baseName=file.name.substring(0,file.name.lastIndexOf('.')).trim().toUpperCase();
      setPhotoProgress({done:i,total:arr.length,current:baseName});
      const prod=products.find(p=>p.sku.toUpperCase()===baseName||p.id.toUpperCase()===baseName);
      if(!prod){skipped++;continue;}
      try{
        const r=ref(storage,`products/${Date.now()}-${file.name.replace(/[^\w.-]/g,'_')}`);
        await uploadBytes(r,file);
        const url=await getDownloadURL(r);
        await updateDoc(doc(db,'products',prod.id),{imageUrl:url});
        matched++;
      }catch{
        skipped++;
      }
    }
    setPhotoProgress(null);
    setPhotoMsg(`Successfully uploaded and linked ${matched} product photo(s)! ${skipped>0?`(${skipped} file(s) did not match an existing SKU or failed).`:''}`);
  }

  return <div className="space-y-6">
    {/* Section 1: Spreadsheet Importer */}
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      <h2 className="font-bold text-base">1. Import Products from Excel / CSV</h2>
      <p className="text-sm text-ink/70">
        Upload a file with columns: <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">SKU</code>, <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">NAME</code>, <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">CATEGORY</code>, <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">STOCK</code>, <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">UNIT</code>, <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">RETAIL PRICE</code>, <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">STAFF PRICE</code>, and optional <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">IMAGE_URL</code>.
      </p>
      <input type="file" accept=".csv,.xls,.xlsx" onChange={e=>e.target.files&&load(e.target.files[0])}/>
      {errs.length>0&&<ul role="alert" className="list-disc pl-5 text-sm text-label">{errs.slice(0,20).map(x=><li key={x}>{x}</li>)}</ul>}
      {rows.length>0&&<><p className="text-sm font-medium">{rows.filter(r=>r.isNew).length} new · {rows.filter(r=>!r.isNew).length} updates{errs.length>0&&` · ${errs.length} rows skipped`}</p>
        <div className="max-h-80 overflow-auto rounded border border-line bg-white">
          <table className="w-full text-xs text-left">
            <thead className="bg-frost border-b border-line text-ink/70 sticky top-0">
              <tr>
                <th className="p-2">Type</th>
                <th className="p-2">SKU</th>
                <th className="p-2">Name</th>
                <th className="p-2">Category</th>
                <th className="p-2">Stock</th>
                <th className="p-2">Retail</th>
                <th className="p-2">Slabs</th>
                <th className="p-2">Staff</th>
                <th className="p-2">Cost</th>
                <th className="p-2">Min Price</th>
                <th className="p-2">Photo</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0,100).map(r=><tr key={r.sku} className="border-b border-line hover:bg-frost/40">
                <td className="p-2 font-medium">{r.isNew?'New':'Update'}</td>
                <td className="p-2 font-mono">{r.sku}</td>
                <td className="p-2 font-medium">{r.name}</td>
                <td className="p-2"><span className="rounded bg-frost px-1.5 py-0.5 font-medium border border-line text-ink">{r.category}</span></td>
                <td className="p-2">{r.stock} {r.unit}</td>
                <td className="p-2 font-semibold">RM{r.retailPrice?.toFixed(2)}</td>
                <td className="p-2">
                  {r.priceSlabs&&r.priceSlabs.length>0 ? (
                    <span className="bg-blue-50 text-blue-800 px-1 py-0.5 rounded font-medium border border-blue-200" title={r.priceSlabs.map((s:any)=>`≥${s.minQty}: RM${s.price.toFixed(2)}`).join(' | ')}>
                      {r.priceSlabs.length} slabs
                    </span>
                  ) : '-'}
                </td>
                <td className="p-2">RM{r.staffPrice?.toFixed(2)}</td>
                <td className="p-2 text-emerald-800">{r.purchasePrice ? `RM${r.purchasePrice.toFixed(2)}` : '-'}</td>
                <td className="p-2 text-amber-800">
                  {r.minPricePcs ? `RM${r.minPricePcs.toFixed(2)}/pcs ` : ''}
                  {r.minPriceCtn ? `RM${r.minPriceCtn.toFixed(2)}/ctn` : ''}
                  {!r.minPricePcs && !r.minPriceCtn ? '-' : ''}
                </td>
                <td className="p-2">{r.imageUrl?<span className="text-brine font-medium">✓ Photo{r.hasPreservedPhoto?' (kept)':''}</span>:'-'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <button className="btn" disabled={busy} onClick={commit}>{busy?'Importing...':`Import ${rows.length} products`}</button></>}
      {msg&&<p role="status" className="text-sm font-medium text-brine">{msg}</p>}
    </div>

    {/* Section 2: Bulk Photo Upload by SKU */}
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      <h2 className="font-bold text-base">2. Bulk Photo Upload (Matched by SKU)</h2>
      <p className="text-sm text-ink/70">
        Have image files on your computer? Name each photo file after its <strong>SKU</strong> (for example: <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">PD-BEV-0002.jpg</code> or <code className="bg-frost px-1.5 py-0.5 rounded text-xs font-semibold">P001.png</code>). Select multiple photos at once, and they will automatically attach to each product!
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          multiple
          accept="image/*"
          disabled={photoProgress !== null || relinking}
          onChange={e=>handleBulkPhotos(e.target.files)}
        />
        <button
          type="button"
          className="btn-alt text-xs font-semibold py-1.5 px-3 border border-brine/40 text-brine hover:bg-brine/10"
          disabled={photoProgress !== null || relinking}
          onClick={relinkExistingPhotos}
        >
          {relinking ? 'Scanning & Relinking...' : '🔄 Restore / Relink Existing Photos from Storage'}
        </button>
      </div>
      {photoProgress && (
        <div className="p-3 bg-frost rounded border border-line text-sm space-y-1">
          <p className="font-medium text-brine animate-pulse">
            Uploading photos: {photoProgress.done} of {photoProgress.total} completed... {photoProgress.current ? `(matching SKU: ${photoProgress.current})` : ''}
          </p>
          <div className="w-full bg-line rounded-full h-2 overflow-hidden">
            <div className="bg-brine h-2 transition-all duration-300" style={{ width: `${Math.round((photoProgress.done / photoProgress.total) * 100)}%` }}></div>
          </div>
        </div>
      )}
      {photoMsg && <p role="status" className="text-sm font-medium text-brine">{photoMsg}</p>}
    </div>
  </div>;
}
