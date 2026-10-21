'use client';
import Link from 'next/link';
import {useStore} from '@/lib/store';
export default function CartPage(){
  const {products,cart,price,setQty,settings}=useStore();
  const lines=products.filter(p=>cart[p.id]);const total=lines.reduce((s,p)=>s+price(p,cart[p.id])*cart[p.id],0);
  if(!lines.length)return <p className="py-16 text-center">Your cart is empty. <Link href="/" className="font-semibold underline">Browse products</Link></p>;
  return <div className="max-w-2xl"><h1 className="mb-4 text-2xl font-bold">Cart</h1>
    {lines.map(p=>{
      const q = cart[p.id];
      const unitPrice = price(p,q);
      const isSlabApplied = Array.isArray(p.priceSlabs) && p.priceSlabs.length>0 && unitPrice < p.retailPrice;
      return (
        <div key={p.id} className="flex items-center gap-3 border-b border-line py-3">
          <div className="flex-1">
            <p className="font-medium">{p.name}</p>
            <p className="text-sm text-ink/60">
              {settings.currency}{unitPrice.toFixed(2)} / {p.unit}
              {isSlabApplied && (
                <span className="ml-2 rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 text-[10px] font-bold">
                  Tier rate
                </span>
              )}
            </p>
          </div>
          <div className="w-20 shrink-0">
            <input type="number" min={1} className="inp text-center font-medium" value={cart[p.id]} onChange={e=>setQty(p.id,+e.target.value)} aria-label={`Quantity for ${p.name}`}/>
          </div>
          <p className="w-24 text-right font-semibold">{settings.currency}{(unitPrice*q).toFixed(2)}</p>
          <button onClick={()=>setQty(p.id,0)} className="text-sm text-label">Remove</button>
        </div>
      );
    })}
    <p className="mt-4 text-right text-xl font-bold">Total {settings.currency}{total.toFixed(2)}</p>
    <div className="mt-4 text-right"><Link href="/checkout" className="btn">Checkout</Link></div></div>;
}
