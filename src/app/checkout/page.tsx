'use client';
import {useState, useEffect} from 'react';
import {httpsCallable} from 'firebase/functions';
import {fns} from '@/lib/firebase';
import {useStore} from '@/lib/store';
import {buildMessage,waLink} from '@/lib/whatsapp';
const M={standard:'STANDARD DELIVERY',urgent:'URGENT DELIVERY',pickup:'SELF PICKUP'} as const;
const SAVED_KEYS = ['name','phone','company','address','city','state','postcode','collector','collectorPhone','vehicle','instructions'];

export default function Checkout(){
  const {products,cart,price,settings,clear}=useStore();
  const [m,setM]=useState<keyof typeof M>('standard');
  const [f,setF]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const [hasSaved,setHasSaved]=useState(false);
  const [remember,setRemember]=useState(true);

  useEffect(()=>{
    try{
      const saved=localStorage.getItem('fh-customer-details');
      if(saved){
        const parsed=JSON.parse(saved);
        if(parsed && typeof parsed==='object'){
          setF(prev=>({...parsed,...prev}));
          if(parsed.name||parsed.phone) setHasSaved(true);
        }
      }
    }catch{}
  },[]);

  const set=(k:string)=>(e:any)=>setF(prev=>({...prev,[k]:e.target.value}));
  const clearSaved=()=>{
    try{localStorage.removeItem('fh-customer-details')}catch{}
    setF({});
    setHasSaved(false);
  };

  const lines=products.filter(p=>cart[p.id]).map(p=>({sku:p.sku,name:p.name,unit:p.unit,qty:cart[p.id],price:price(p,cart[p.id])}));
  const total=lines.reduce((sum,line)=>sum+line.qty*line.price,0);
  const F=(k:string,l:string,type='text',req=false)=><div key={k}><label className="lbl">{l}{req&&' *'}</label><input type={type} className="inp" value={f[k]||''} onChange={set(k)}/></div>;

  async function submit(){
    const need=['name','phone',...(m==='pickup'?['date','time','collector']:['address','city','state','postcode',...(m==='urgent'?['date','time','reason']:['date'])])];
    const miss=need.filter(k=>!f[k]?.trim());if(miss.length||!lines.length){setErr('Fill in all fields marked *.');return}
    setBusy(true);setErr('');

    if(remember){
      try{
        const toSave:Record<string,string>={};
        SAVED_KEYS.forEach(k=>{if(f[k])toSave[k]=f[k].trim()});
        localStorage.setItem('fh-customer-details',JSON.stringify(toSave));
      }catch{}
    }

    const payload={
      customer:{name:f.name.trim(),phone:f.phone.trim(),company:(f.company||'').trim()},
      method:M[m],
      delivery:f,
      items:cart
    };
    const fingerprint=JSON.stringify(payload);
    let requestId='';
    try{
      const saved=JSON.parse(sessionStorage.getItem('fh-checkout-request')||'null');
      requestId=saved?.fingerprint===fingerprint&&typeof saved?.requestId==='string'
        ?saved.requestId:'';
      if(!requestId){
        requestId=typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'
          ?crypto.randomUUID()
          :Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
        sessionStorage.setItem('fh-checkout-request',JSON.stringify({fingerprint,requestId}));
      }
    }catch{
      requestId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
    }

    try{
      const createOrder=httpsCallable(fns,'createOrder');
      const result=await createOrder({...payload,requestId});
      const verified=result.data as {orderId:string;lines:{sku:string;name:string;unit:string;qty:number;price:number}[];total:number;currency:string};
      const verifiedLines=verified.lines.map(l=>({sku:l.sku,name:l.name,unit:l.unit,qty:l.qty,price:l.price}));
      const address=m==='pickup'?'':[f.address,f.city,f.state,f.postcode].join(', ');
      const when=[f.date,f.time].filter(Boolean).join(' ');
      const msg=buildMessage({customer:f.name,phone:f.phone,company:f.company||'',method:M[m],address,when,lines:verifiedLines,total:verified.total,currency:verified.currency||settings.currency,notes:[f.instructions,f.notes].filter(Boolean).join('. '),urgent:f.reason});
      try{sessionStorage.removeItem('fh-checkout-request')}catch{}
      clear();window.location.href=waLink(settings.whatsappNumber,msg);
    }catch(e:any){
      const code=e?.code||'';
      setErr(code==='functions/failed-precondition'?(e.message||'A product price or stock level changed. Review your cart and try again.'):'Could not save the order. Check your connection and try again.');
      setBusy(false);
    }
  }

  return <div className="max-w-xl space-y-4">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Checkout</h1>
      {hasSaved && (
        <span className="flex items-center gap-2 text-xs text-brine bg-brine/10 px-2.5 py-1 rounded-full font-medium">
          ✓ Details pre-filled
          <button type="button" onClick={clearSaved} className="text-ink/50 hover:text-ink underline ml-1">Clear</button>
        </span>
      )}
    </div>

    {F('name','Customer name','text',true)}
    {F('phone','Phone number','tel',true)}
    {F('company','Company name')}

    <div>
      <span className="lbl">Delivery method *</span>
      <div className="grid grid-cols-3 gap-2">
        {([['standard','🚚 Standard'],['urgent','⚡ Urgent'],['pickup','📦 Pickup']] as const).map(([k,l])=><button key={k} type="button" onClick={()=>setM(k)} className={'rounded-md border px-2 py-2 text-sm '+(m===k?'border-ink bg-ink text-white':'border-line bg-white')}>{l}</button>)}
      </div>
    </div>

    {m==='urgent'&&<p className="rounded bg-label px-3 py-2 text-sm font-bold text-white">URGENT ORDER</p>}
    {m!=='pickup'&&<>{F('address','Address','text',true)}{F('city','City','text',true)}{F('state','State','text',true)}{F('postcode','Postcode','text',true)}</>}
    {m==='standard'&&F('date','Delivery date','date',true)}
    {m==='urgent'&&<>{F('date','Required date','date',true)}{F('time','Required time','time',true)}{F('reason','Urgent reason','text',true)}</>}
    {m==='pickup'&&<>{F('date','Pickup date','date',true)}{F('time','Pickup time','time',true)}{F('collector','Collector name','text',true)}{F('collectorPhone','Collector phone','tel')}{F('vehicle','Vehicle number')}</>}
    {m!=='pickup'&&F('instructions','Delivery instructions')}
    {F('notes','Order notes')}

    <label className="flex items-center gap-2 text-xs text-ink/70 cursor-pointer pt-1">
      <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} className="rounded text-brine" />
      Save my contact & delivery details on this device for future orders
    </label>

    {err&&<p role="alert" className="text-sm text-label font-medium">{err}</p>}
    <p className="text-lg font-bold">Estimated total {settings.currency}{total.toFixed(2)}</p>
    <button className="btn w-full" disabled={busy} onClick={submit}>Send order on WhatsApp</button>
  </div>;
}
