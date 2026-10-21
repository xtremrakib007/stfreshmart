'use client';
import {useEffect,useState} from 'react';
import {doc,setDoc,collection,addDoc,deleteDoc,onSnapshot,query,orderBy,updateDoc} from 'firebase/firestore';
import {ref,uploadBytes,getDownloadURL} from 'firebase/storage';
import {db,storage} from '@/lib/firebase';
import {useStore} from '@/lib/store';
export function SettingsTab(){
  const {settings}=useStore();const [f,setF]=useState<any>(settings);const [msg,setMsg]=useState('');
  useEffect(()=>setF(settings),[settings]);
  const k=(n:string)=>(e:any)=>setF({...f,[n]:n==='lowStockThreshold'?+e.target.value:e.target.value});
  async function logo(file:File){try{const r=ref(storage,`logo/${Date.now()}-${file.name.replace(/[^\w.-]/g,'_')}`);await uploadBytes(r,file);setF({...f,logoUrl:await getDownloadURL(r)})}catch{setMsg('Logo upload failed (images under 5 MB only).')}}
  async function save(){if(!/^\d{9,15}$/.test(String(f.whatsappNumber).replace(/\D/g,''))){setMsg('Enter the WhatsApp number with country code, e.g. 60123456789.');return}
    try{await setDoc(doc(db,'settings','main'),f);setMsg('Settings saved.')}catch{setMsg('Could not save settings.')}}
  const L:[string,string][]=[['companyName','Company name'],['whatsappNumber','WhatsApp number (with country code)'],['supportEmail','Support email'],['supportPhone','Support phone'],['currency','Currency'],['lowStockThreshold','Low stock threshold']];
  return <div className="space-y-8">
    {/* General Settings */}
    <div className="max-w-md space-y-3">
      <h2 className="font-bold text-lg">General Settings</h2>
      {L.map(([n,l])=><div key={n}><label className="lbl">{l}</label><input className="inp" type={n==='lowStockThreshold'?'number':'text'} value={f[n]??''} onChange={k(n)}/></div>)}
      <div><label className="lbl">Company logo</label>{f.logoUrl&&<img src={f.logoUrl} alt="" className="mb-2 h-12"/>}<input type="file" accept="image/*" onChange={e=>e.target.files&&logo(e.target.files[0])}/></div>
      <button className="btn" onClick={save}>Save settings</button>{msg&&<p role="status" className="text-sm">{msg}</p>}
    </div>

    {/* Banner Management */}
    <BannerManager/>
  </div>;
}

function BannerManager(){
  const [banners,setBanners]=useState<any[]>([]);
  const [uploading,setUploading]=useState(false);
  const [msg,setMsg]=useState('');

  useEffect(()=>{
    return onSnapshot(query(collection(db,'banners'),orderBy('order','asc')),s=>{
      setBanners(s.docs.map(d=>({id:d.id,...d.data()})));
    });
  },[]);

  async function addBanner(file:File){
    setUploading(true);setMsg('Uploading banner...');
    try{
      const r=ref(storage,`banners/${Date.now()}-${file.name.replace(/[^\w.-]/g,'_')}`);
      await uploadBytes(r,file);
      const url=await getDownloadURL(r);
      await addDoc(collection(db,'banners'),{
        imageUrl:url,
        title:'',
        active:true,
        order:banners.length,
        createdAt:new Date()
      });
      setMsg('Banner added!');
    }catch(e:any){
      setMsg('Upload failed: '+(e?.message||'Image under 5 MB only.'));
    }finally{setUploading(false)}
  }

  async function toggleActive(id:string,current:boolean){
    await updateDoc(doc(db,'banners',id),{active:!current});
  }

  async function removeBanner(id:string){
    if(!confirm('Delete this banner?'))return;
    await deleteDoc(doc(db,'banners',id));
  }

  async function updateTitle(id:string,title:string){
    await updateDoc(doc(db,'banners',id),{title});
  }

  async function moveUp(idx:number){
    if(idx<=0)return;
    const b=banners;
    await updateDoc(doc(db,'banners',b[idx].id),{order:b[idx-1].order});
    await updateDoc(doc(db,'banners',b[idx-1].id),{order:b[idx].order});
  }

  return(
    <div className="space-y-3">
      <h2 className="font-bold text-lg">🖼️ Promotion Banners</h2>
      <p className="text-sm text-ink/70">
        Upload banner images that will appear as a carousel on the main storefront page. Recommended size: <strong>1200×400px</strong> or wider.
      </p>

      <div className="flex items-center gap-3">
        <label className={`btn cursor-pointer ${uploading?'opacity-50':''}`}>
          {uploading?'Uploading...':'+ Upload Banner'}
          <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={e=>e.target.files&&addBanner(e.target.files[0])}/>
        </label>
      </div>

      {banners.length===0&&<p className="text-sm text-ink/50 py-4">No banners yet. Upload your first promotion banner above.</p>}

      <div className="space-y-3">
        {banners.map((b,i)=>(
          <div key={b.id} className={'flex items-center gap-3 rounded-lg border p-3 '+(b.active?'border-brine/30 bg-white':'border-line bg-frost/50 opacity-60')}>
            <img src={b.imageUrl} alt={b.title||'Banner'} className="h-16 w-28 rounded border border-line object-cover bg-white"/>
            <div className="flex-1 min-w-0 space-y-1">
              <input
                className="inp text-sm py-1"
                placeholder="Banner title (optional)"
                value={b.title||''}
                onChange={e=>updateTitle(b.id,e.target.value)}
              />
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={'rounded px-2 py-0.5 font-medium '+(b.active?'bg-brine/10 text-brine':'bg-gray-100 text-gray-500')}>
                  {b.active?'✓ Active':'Hidden'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={()=>moveUp(i)} disabled={i===0} className="text-xs btn-alt py-0.5 px-2 disabled:opacity-30" title="Move up">↑</button>
              <button onClick={()=>toggleActive(b.id,b.active)} className="text-xs btn-alt py-0.5 px-2">
                {b.active?'Hide':'Show'}
              </button>
              <button onClick={()=>removeBanner(b.id)} className="text-xs text-label hover:underline py-0.5 px-2">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {msg&&<p role="status" className="text-sm font-medium">{msg}</p>}
    </div>
  );
}
