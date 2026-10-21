'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useStore} from '@/lib/store';
export default function ProductPage(){
  const {products,price,stockState,cart,setQty,settings,role}=useStore();
  const [id,setId]=useState('');const [qty,setN]=useState(1);
  const [zoom,setZoom]=useState(false);
  const [imgErr,setImgErr]=useState(false);
  const [fromCat,setFromCat]=useState('');

  useEffect(()=>{
    if(typeof window==='undefined')return;
    const params=new URLSearchParams(window.location.search);
    setId(params.get('id')||'');
    setFromCat(params.get('cat')||'');
  },[]);

  // Intercept back button when zoom lightbox is open so it only closes the photo
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const onPopState=()=>{
      setZoom(false);
    };
    window.addEventListener('popstate',onPopState);
    return ()=>window.removeEventListener('popstate',onPopState);
  },[]);

  const openZoom=()=>{
    setZoom(true);
    if(typeof window!=='undefined'){
      window.history.pushState({photoZoom:true},'');
    }
  };

  const closeZoom=()=>{
    setZoom(false);
    if(typeof window!=='undefined'&&window.history.state?.photoZoom){
      window.history.back();
    }
  };

  useEffect(()=>{
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeZoom();
    };
    if (zoom) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoom]);

  const p=products.find(x=>x.id===id);
  const backHref = fromCat ? `/?cat=${encodeURIComponent(fromCat)}` : '/';
  if(!p)return <p className="py-16 text-center">Product not found. <Link href={backHref} className="font-semibold underline">Back to catalog</Link></p>;
  const s=stockState(p);
  const hasPromo=role==='customer'&&p.promoPrice&&p.promoPrice>0&&p.promoPrice<p.retailPrice;

  return <div className="space-y-4">
    <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/70 hover:text-ink">
      <span>←</span> Back to {fromCat || 'catalog'}
    </Link>
    <div className="grid gap-8 md:grid-cols-2">
      {p.imageUrl && !imgErr ? (
        <div className="relative group">
          <button
            type="button"
            onClick={openZoom}
            className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-4 shadow-sm cursor-zoom-in"
            title="Click to view full photo"
          >
            {hasPromo&&<span className="absolute top-3 left-3 z-[1] rounded-lg bg-red-500 px-3 py-1 text-sm font-bold text-white shadow-lg">🔥 SALE</span>}
            <img
              src={p.imageUrl}
              alt={p.name}
              onError={()=>setImgErr(true)}
              className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
            />
            <div className="absolute bottom-3 right-3 rounded-md bg-ink/70 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 flex items-center gap-1 shadow">
              <span>🔍</span> Click to view full photo
            </div>
          </button>
        </div>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white text-ink/40">
          <span className="text-5xl mb-2">📦</span>
          <span className="text-sm font-medium">{imgErr ? 'Image could not load' : 'No image uploaded'}</span>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <span className="rounded bg-frost px-2 py-0.5 text-xs font-semibold uppercase text-ink/70">{p.category}</span>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{p.name}</h1>
          <p className="text-xs text-ink/50 mt-1">SKU: {p.sku}</p>
        </div>
        {hasPromo?(
          <div>
            <p className="text-lg text-ink/50 line-through">
              {settings.currency}{p.retailPrice.toFixed(2)}
            </p>
            <p className="text-3xl font-extrabold text-red-600">
              {settings.currency}{p.promoPrice!.toFixed(2)}
              <span className="text-base font-normal text-ink/60"> / {p.unit}</span>
            </p>
            <span className="inline-block mt-1 rounded bg-red-100 text-red-700 px-2 py-0.5 text-xs font-bold border border-red-200">
              Save {settings.currency}{(p.retailPrice - p.promoPrice!).toFixed(2)} ({Math.round(((p.retailPrice - p.promoPrice!) / p.retailPrice) * 100)}% OFF)
            </span>
          </div>
        ):(
          <div>
            <p className="text-3xl font-extrabold text-ink">
              {settings.currency}{price(p,qty).toFixed(2)}
              <span className="text-base font-normal text-ink/60"> / {p.unit}</span>
            </p>
            {Array.isArray(p.priceSlabs) && p.priceSlabs.length>0 && price(p,qty) < p.retailPrice && (
              <span className="inline-block mt-1 rounded bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-bold border border-blue-200">
                Tier discount applied! Saving {settings.currency}{(p.retailPrice - price(p,qty)).toFixed(2)}/{p.unit}
              </span>
            )}
          </div>
        )}

        {/* Wholesale Price Slabs Table */}
        {Array.isArray(p.priceSlabs) && p.priceSlabs.length>0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-1.5 mt-1">
            <p className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
              <span>📊</span> Wholesale Volume Discounts:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
              <div className={'rounded border p-1.5 transition-colors '+(qty<p.priceSlabs[0].minQty?'border-blue-400 bg-white font-semibold text-blue-900 shadow-sm':'border-blue-200 bg-white/70 text-ink/70')}>
                <span className="block text-[10px] text-ink/50 uppercase">1 - {p.priceSlabs[0].minQty - 1} {p.unit}</span>
                <span className="text-sm font-bold">{settings.currency}{p.retailPrice.toFixed(2)}</span>/{p.unit}
              </div>
              {p.priceSlabs.map((s,i)=>{
                const nextSlab = p.priceSlabs![i+1];
                const isSelected = qty >= s.minQty && (!nextSlab || qty < nextSlab.minQty);
                return (
                  <div key={i} className={'rounded border p-1.5 transition-colors '+(isSelected?'border-blue-500 bg-white font-semibold text-blue-900 ring-2 ring-blue-300 shadow-sm':'border-blue-200 bg-white/70 text-ink/70')}>
                    <span className="block text-[10px] text-ink/50 uppercase">{nextSlab ? `${s.minQty} - ${nextSlab.minQty - 1} ${p.unit}` : `≥ ${s.minQty} ${p.unit}`}</span>
                    <span className="text-sm font-bold text-blue-800">{settings.currency}{s.price.toFixed(2)}</span>/{p.unit}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className={'text-sm font-semibold '+(s==='In Stock'?'text-brine':s==='Low Stock'?'text-amber-700':'text-label')}>{s}</p>
        {p.description && <p className="text-sm text-ink/80 whitespace-pre-line border-t border-line/60 pt-3">{p.description}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="w-24 shrink-0">
            <input type="number" min={1} className="inp text-center font-medium" value={qty} onChange={e=>setN(Math.max(1,+e.target.value))} aria-label="Quantity"/>
          </div>
          <button className="btn px-6 py-2.5" disabled={s==='Out Of Stock'} onClick={()=>setQty(p.id,(cart[p.id]||0)+qty)}>
            {cart[p.id] ? `Add more (${cart[p.id]} in cart)` : 'Add to cart'}
          </button>
          {cart[p.id] && (
            <Link href="/cart" className="btn-alt px-4 py-2.5 text-sm">
              View cart ({cart[p.id]}) →
            </Link>
          )}
        </div>
      </div>
    </div>

    {/* Lightbox / Full Photo Modal */}
    {zoom && p.imageUrl && (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        onClick={closeZoom}
      >
        <div className="relative max-h-[90vh] max-w-[90vw] flex flex-col items-center" onClick={e=>e.stopPropagation()}>
          <button
            onClick={closeZoom}
            className="absolute -top-11 right-0 rounded-full bg-white/20 px-3 py-1 text-white hover:bg-white/40 transition text-sm font-bold flex items-center gap-1.5"
            aria-label="Close"
          >
            ✕ Close
          </button>
          <img
            src={p.imageUrl}
            alt={p.name}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain bg-white shadow-2xl p-2"
          />
          <p className="mt-3 text-center text-sm font-semibold text-white">{p.name}</p>
        </div>
      </div>
    )}
  </div>;
}
