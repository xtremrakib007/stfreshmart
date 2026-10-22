'use client';
import {useEffect,useMemo,useState} from 'react';
import {collection,limit,onSnapshot,orderBy,query} from 'firebase/firestore';
import {db} from '@/lib/firebase';
import {useStore} from '@/lib/store';

type Movement = {
  id:string; sku?:string; from?:number; to?:number; variance?:number; reason?:string;
  type?:string; supplier?:string; reference?:string; quantity?:number;
  expectedStock?:number; countedStock?:number; changedBy?:string; at?:any;
};

function movementType(m:Movement):string {
  if(m.type==='supplier_receipt')return 'Supplier receipt';
  if(m.type==='stock_count')return 'Physical count';
  if(m.reason?.startsWith('adjustment:'))return 'Adjustment';
  if(m.reason==='manual')return 'Product edit';
  if(m.reason?.startsWith('order:')||m.reason?.startsWith('order '))return 'Order';
  return 'Stock movement';
}
function when(value:any):string {
  try {
    const date=value?.toDate?.() ?? (value instanceof Date?value:null);
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
  } catch { return '—'; }
}
function number(value:any):string {
  return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString():'—';
}

export function InventoryHistory(){
  const {role}=useStore();
  const [rows,setRows]=useState<Movement[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [kind,setKind]=useState('all');

  useEffect(()=>{
    if(role!=='admin'&&role!=='staff'){setRows([]);setLoading(false);setError('Inventory history is available to active staff and admins only.');return;}
    setLoading(true);setError('');
    return onSnapshot(query(collection(db,'inventoryHistory'),orderBy('at','desc'),limit(300)),snapshot=>{
      setRows(snapshot.docs.map(d=>({id:d.id,...d.data()} as Movement)));
      setLoading(false);
    },()=>{
      setError('Could not load inventory history. Check your staff access and connection.');
      setLoading(false);
    });
  },[role]);

  const filtered=useMemo(()=>{
    const term=search.trim().toLowerCase();
    return rows.filter(row=>{
      const type=movementType(row);
      if(kind!=='all'&&type!==kind)return false;
      const haystack=[row.sku,row.reason,row.supplier,row.reference,row.changedBy,type].filter(Boolean).join(' ').toLowerCase();
      return !term||haystack.includes(term);
    });
  },[rows,search,kind]);

  if(role!=='admin'&&role!=='staff')return <p className="py-8 text-center text-sm text-ink/60">Staff and admins only.</p>;

  return <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-ink">Inventory movement history</h2><p className="text-sm text-ink/60">Recent stock receipts, adjustments, physical counts and other recorded movements.</p></div>
      <span className="rounded-full border border-line bg-white px-3 py-1 text-xs text-ink/70">Latest 300 records</span>
    </div>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
      <input className="inp" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search SKU, reason, supplier or reference"/>
      <select className="inp" value={kind} onChange={e=>setKind(e.target.value)}>
        <option value="all">All movement types</option>
        <option value="Supplier receipt">Supplier receipts</option>
        <option value="Adjustment">Stock adjustments</option>
        <option value="Physical count">Physical counts</option>
        <option value="Product edit">Product editor changes</option>
        <option value="Order">Order movements</option>
        <option value="Stock movement">Other movements</option>
      </select>
    </div>
    {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading?<p className="py-8 text-center text-sm text-ink/60">Loading inventory history…</p>:
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[850px] border-collapse text-left text-sm">
          <thead className="bg-frost text-xs uppercase tracking-wide text-ink/60"><tr>
            <th className="p-3">Date</th><th className="p-3">SKU</th><th className="p-3">Type / details</th><th className="p-3 text-right">From</th><th className="p-3 text-right">To</th><th className="p-3 text-right">Change</th><th className="p-3">Recorded by</th>
          </tr></thead>
          <tbody>
            {filtered.map(row=>{
              const delta=typeof row.from==='number'&&typeof row.to==='number'?row.to-row.from:null;
              return <tr key={row.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-3 text-xs text-ink/60">{when(row.at)}</td>
                <td className="p-3 font-mono font-semibold">{row.sku||'—'}</td>
                <td className="max-w-[360px] p-3">
                  <span className="inline-flex rounded-full border border-line bg-frost px-2 py-0.5 text-xs font-medium">{movementType(row)}</span>
                  <p className="mt-1 break-words text-xs text-ink/70">{row.reason||'No reason recorded'}</p>
                  {(row.supplier||row.reference)&&<p className="mt-1 text-xs text-ink/60">{row.supplier&&<>Supplier: {row.supplier}</>}{row.supplier&&row.reference?' · ':''}{row.reference&&<>Ref: {row.reference}</>}</p>}
                  {row.type==='stock_count'&&<p className="mt-1 text-xs text-ink/60">Counted {number(row.countedStock)} · variance {typeof row.variance==='number'&&row.variance>0?'+':''}{number(row.variance)}</p>}
                </td>
                <td className="p-3 text-right tabular-nums">{number(row.from)}</td>
                <td className="p-3 text-right tabular-nums font-semibold">{number(row.to)}</td>
                <td className={'p-3 text-right tabular-nums font-semibold '+(delta===null?'text-ink/50':delta>0?'text-emerald-700':delta<0?'text-red-700':'text-ink/60')}>{delta===null?'—':delta>0?'+'+number(delta):number(delta)}</td>
                <td className="p-3 font-mono text-xs text-ink/60">{row.changedBy||'—'}</td>
              </tr>;
            })}
            {!filtered.length&&<tr><td colSpan={7} className="p-8 text-center text-sm text-ink/50">{rows.length?'No movements match these filters.':'No inventory movements recorded yet.'}</td></tr>}
          </tbody>
        </table>
      </div>}
    <p className="text-xs text-ink/50">This view is read-only and shows up to 300 recent records. Older movements may not appear in this list.</p>
  </section>;
}
