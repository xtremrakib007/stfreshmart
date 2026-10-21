'use client';
import {useState} from 'react';
import {collection,doc,runTransaction} from 'firebase/firestore';
import {db} from '@/lib/firebase';
import {useStore} from '@/lib/store';

const NEXT:Record<string,[string,string]>={Pending:['Accepted','Accept'],Accepted:['Preparing','Prepare'],Preparing:['Ready','Mark ready'],Ready:['Out For Delivery','Dispatch'],'Out For Delivery':['Delivered','Complete']};

export function Orders({orders}:{orders:any[]}){
  const {settings}=useStore();
  const [err,setErr]=useState('');
  const [flt,setFlt]=useState('Active');
  const [invOrder,setInvOrder]=useState<any|null>(null);

  async function move(o:any,to:string){
    setErr('');
    try{await runTransaction(db,async t=>{
      const oref=doc(db,'orders',o.id);const cur=(await t.get(oref)).data()!;
      const deduct=to==='Accepted'&&!cur.stockDeducted,restore=to==='Cancelled'&&cur.stockDeducted;
      const snaps=deduct||restore?await Promise.all(cur.items.map((i:any)=>t.get(doc(db,'products',i.sku)))):[];
      snaps.forEach((s,idx)=>{if(!s.exists())return;const i=cur.items[idx],from=s.data()!.stock,next=Math.max(0,from+(deduct?-i.qty:i.qty));
        t.update(s.ref,{stock:next});t.set(doc(collection(db,'inventoryHistory')),{sku:i.sku,from,to:next,reason:deduct?`order ${o.id}`:`cancel ${o.id}`,at:new Date()})});
      t.update(oref,{status:to,...(deduct?{stockDeducted:true}:{}),...(restore?{stockDeducted:false}:{})});
    })}catch{setErr('Could not update this order. Try again.')}
  }

  function shareWhatsAppInvoice(o:any){
    const d=o.delivery||{};
    const linesText=o.items.map((i:any,idx:number)=>
      `${idx+1}. *${i.name}* (${i.sku})\n   ${i.qty} ${i.unit} x ${settings.currency}${i.price.toFixed(2)} = *${settings.currency}${(i.qty*i.price).toFixed(2)}*`
    ).join('\n');

    const addr = o.method==='SELF PICKUP'
      ? `Self Pickup: Collector ${d.collector||''} (${d.collectorPhone||''})`
      : `Address: ${[d.address,d.city,d.state,d.postcode].filter(Boolean).join(', ')}`;

    const text=[
      `*${settings.companyName.toUpperCase()}*`,
      `*PRE-INVOICE / ORDER CONFIRMATION*`,
      `--------------------------------`,
      `*Order #:* ORD-${o.id.slice(-6).toUpperCase()}`,
      `*Date:* ${o.createdAt?.toDate?o.createdAt.toDate().toLocaleString('en-MY'):new Date().toLocaleDateString()}`,
      `*Status:* ${o.status}`,
      `*Customer:* ${o.customer.name}`,
      o.customer.company?`*Company:* ${o.customer.company}`:'',
      `*Phone:* ${o.customer.phone}`,
      `--------------------------------`,
      `*ITEMS ORDERED:*`,
      linesText,
      `--------------------------------`,
      `*TOTAL: ${settings.currency}${o.total.toFixed(2)}*`,
      `--------------------------------`,
      `*Method:* ${o.method}`,
      addr,
      d.date?`*Scheduled Date:* ${d.date} ${d.time||''}`:'',
      [d.instructions,d.notes].filter(Boolean).join('. ')?`*Notes:* ${[d.instructions,d.notes].filter(Boolean).join('. ')}`:'',
      `--------------------------------`,
      `Thank you for your business! - ${settings.companyName}`
    ].filter(Boolean).join('\n');

    const cleanPhone=(o.customer.phone||'').replace(/\D/g,'');
    const url=`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url,'_blank');
  }

  const list=orders.filter(o=>flt==='All'||(flt==='Active'?!['Delivered','Cancelled'].includes(o.status):o.status===flt));

  return <div>
    <div className="mb-3 flex gap-2 overflow-x-auto no-print">
      {['Active','Delivered','Cancelled','All'].map(x=><button key={x} onClick={()=>setFlt(x)} className={flt===x?'btn':'btn-alt'}>{x}</button>)}
    </div>

    {err&&<p role="alert" className="mb-2 text-sm text-label no-print">{err}</p>}
    {list.length===0&&<p className="py-10 text-center text-ink/60 no-print">No orders here yet.</p>}

    <ul className="space-y-3 no-print">
      {list.map(o=>{
        const n=NEXT[o.status];
        const d=o.delivery||{};
        return <li key={o.id} className="rounded-lg border border-line bg-white p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>{o.method==='URGENT DELIVERY'&&<span className="mr-2 rounded bg-label px-2 py-0.5 text-white text-xs">URGENT</span>}{o.customer.name} · {o.customer.phone}</b>
            <span className="rounded bg-frost px-2 py-0.5 font-medium">{o.status}</span>
          </div>
          <p className="text-ink/70 mt-1">{o.method} · {settings.currency}{o.total.toFixed(2)} · {o.createdAt?.toDate?.().toLocaleString('en-MY')} · by {o.placedBy}</p>
          
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-ink/80 hover:text-ink">Order details ({o.items?.length||0} items)</summary>
            <div className="mt-2 space-y-1 bg-frost p-3 rounded border border-line/60">
              <p>{o.customer.company&&`${o.customer.company} · `}{o.method==='SELF PICKUP'?`Collector ${d.collector||''} ${d.collectorPhone||''} ${d.vehicle||''}`:[d.address,d.city,d.state,d.postcode].filter(Boolean).join(', ')}</p>
              <p>{d.date} {d.time} {d.reason&&`· Reason: ${d.reason}`}</p>
              <p>Notes: {[d.instructions,d.notes].filter(Boolean).join('. ')||'None'}</p>
              <ul className="list-disc pl-5 pt-1 space-y-0.5">
                {o.items.map((i:any)=><li key={i.sku}>{i.name} x {i.qty} {i.unit} @ {settings.currency}{i.price}</li>)}
              </ul>
            </div>
          </details>

          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-line/60">
            {n&&<button className="btn" onClick={()=>move(o,n[0])}>{n[1]}</button>}
            {n&&<button className="btn-alt text-label" onClick={()=>confirm('Cancel this order?')&&move(o,'Cancelled')}>Cancel</button>}
            <button className="btn-alt ml-auto flex items-center gap-1.5" onClick={()=>setInvOrder(o)}>
              <span>📄</span> Pre-Invoice / PDF
            </button>
            <button className="btn-alt text-brine flex items-center gap-1.5" onClick={()=>shareWhatsAppInvoice(o)}>
              <span>📲</span> Share WhatsApp
            </button>
          </div>
        </li>;
      })}
    </ul>

    {/* Printable Pre-Invoice Modal */}
    {invOrder && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto no-print" onClick={()=>setInvOrder(null)}>
        <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl overflow-hidden my-6 flex flex-col" onClick={e=>e.stopPropagation()}>
          {/* Action Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-frost border-b border-line no-print">
            <div>
              <h3 className="font-bold text-lg text-ink">Pre-Invoice Preview</h3>
              <p className="text-xs text-ink/60">Order #ORD-{invOrder.id.slice(-6).toUpperCase()}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>window.print()} className="btn flex items-center gap-1.5 text-xs py-2 px-3">
                <span>🖨️</span> Print / Save PDF
              </button>
              <button onClick={()=>shareWhatsAppInvoice(invOrder)} className="btn-alt flex items-center gap-1.5 text-xs py-2 px-3 text-brine">
                <span>📲</span> Send on WhatsApp
              </button>
              <button onClick={()=>setInvOrder(null)} className="rounded-full bg-white border border-line h-8 w-8 flex items-center justify-center text-ink/70 hover:text-ink text-sm font-bold">
                ✕
              </button>
            </div>
          </div>

          {/* Printable Invoice Sheet */}
          <div id="printable-invoice" className="p-8 sm:p-10 space-y-6 bg-white text-ink text-sm">
            {/* Invoice Top Header */}
            <div className="flex justify-between items-start border-b border-line pb-6">
              <div>
                {settings.logoUrl && <img src={settings.logoUrl} alt="" className="h-12 mb-2 object-contain" />}
                <h1 className="text-2xl font-extrabold text-ink">{settings.companyName}</h1>
                <p className="text-xs text-ink/70">Wholesale Meat, Poultry, Fish & Beverages</p>
                <p className="text-xs text-ink/60">Perak, Malaysia</p>
                {settings.supportPhone && <p className="text-xs text-ink/60">Tel: {settings.supportPhone}</p>}
                {settings.supportEmail && <p className="text-xs text-ink/60">Email: {settings.supportEmail}</p>}
              </div>
              <div className="text-right">
                <span className="inline-block bg-brine text-white px-3 py-1 rounded text-xs font-bold uppercase tracking-wider">
                  PRE-INVOICE
                </span>
                <p className="mt-2 text-lg font-bold">#ORD-{invOrder.id.slice(-6).toUpperCase()}</p>
                <p className="text-xs text-ink/70">Date: {invOrder.createdAt?.toDate ? invOrder.createdAt.toDate().toLocaleDateString('en-MY') : new Date().toLocaleDateString()}</p>
                <p className="text-xs text-ink/70">Status: <span className="font-semibold">{invOrder.status}</span></p>
                <p className="text-xs text-ink/70">Method: <span className="font-semibold">{invOrder.method}</span></p>
              </div>
            </div>

            {/* Bill To & Delivery Info */}
            <div className="grid grid-cols-2 gap-6 bg-frost/50 p-4 rounded-lg border border-line/70">
              <div>
                <p className="text-xs font-bold uppercase text-ink/50 tracking-wider">Customer / Bill To</p>
                <p className="font-bold text-base mt-1">{invOrder.customer?.name}</p>
                {invOrder.customer?.company && <p className="text-xs font-medium text-ink/80">{invOrder.customer.company}</p>}
                <p className="text-xs text-ink/70 mt-1">Phone: {invOrder.customer?.phone}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-ink/50 tracking-wider">
                  {invOrder.method==='SELF PICKUP' ? 'Pickup Details' : 'Delivery Address'}
                </p>
                {invOrder.method==='SELF PICKUP' ? (
                  <div className="text-xs space-y-0.5 mt-1">
                    <p className="font-semibold">Collector: {invOrder.delivery?.collector || '-'}</p>
                    <p>Phone: {invOrder.delivery?.collectorPhone || '-'}</p>
                    {invOrder.delivery?.vehicle && <p>Vehicle: {invOrder.delivery.vehicle}</p>}
                    <p>Pickup Time: {invOrder.delivery?.date} {invOrder.delivery?.time}</p>
                  </div>
                ) : (
                  <div className="text-xs space-y-0.5 mt-1">
                    <p className="font-medium">{[invOrder.delivery?.address, invOrder.delivery?.city, invOrder.delivery?.state, invOrder.delivery?.postcode].filter(Boolean).join(', ')}</p>
                    <p className="text-ink/70 mt-1">Delivery Date: {invOrder.delivery?.date} {invOrder.delivery?.time}</p>
                    {invOrder.delivery?.reason && <p className="text-label font-medium">Urgent Reason: {invOrder.delivery.reason}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Line Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-line">
                <thead className="bg-frost text-ink/70 uppercase font-bold text-[10px] tracking-wider border-b border-line">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3 text-center">Unit</th>
                    <th className="py-2.5 px-3 text-right">Price ({settings.currency})</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Total ({settings.currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invOrder.items?.map((i:any,idx:number)=>(
                    <tr key={i.sku||idx} className={idx%2===0?'bg-white':'bg-frost/30'}>
                      <td className="py-2 px-3 text-ink/50">{idx+1}</td>
                      <td className="py-2 px-3 font-mono font-medium">{i.sku}</td>
                      <td className="py-2 px-3 font-semibold">{i.name}</td>
                      <td className="py-2 px-3 text-center">{i.unit}</td>
                      <td className="py-2 px-3 text-right">{i.price?.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-semibold">{i.qty}</td>
                      <td className="py-2 px-3 text-right font-bold">{(i.qty*i.price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals & Notes */}
            <div className="flex justify-between items-start pt-2">
              <div className="max-w-xs space-y-1 text-xs">
                {[invOrder.delivery?.instructions, invOrder.delivery?.notes].filter(Boolean).length > 0 && (
                  <div className="bg-frost p-2.5 rounded border border-line">
                    <p className="font-bold text-[10px] uppercase text-ink/60">Special Instructions:</p>
                    <p className="text-xs text-ink/80 mt-0.5">{[invOrder.delivery?.instructions, invOrder.delivery?.notes].filter(Boolean).join('. ')}</p>
                  </div>
                )}
              </div>
              <div className="w-64 space-y-2 text-right">
                <div className="flex justify-between text-xs text-ink/70">
                  <span>Subtotal:</span>
                  <span>{settings.currency}{invOrder.total?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-ink/70">
                  <span>Delivery:</span>
                  <span>Included</span>
                </div>
                <div className="flex justify-between text-base font-extrabold border-t-2 border-ink pt-2 text-ink">
                  <span>Estimated Total:</span>
                  <span>{settings.currency}{invOrder.total?.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-line pt-6 text-center text-xs text-ink/50 space-y-1">
              <p className="font-medium text-ink/70">This is a computer-generated pre-invoice for order verification.</p>
              <p>For any inquiries regarding this order, please contact {settings.companyName} at {settings.supportPhone || settings.whatsappNumber}.</p>
              <p className="text-[10px]">Thank you for your business!</p>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>;
}
