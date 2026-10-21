'use client';
import {useState, useMemo, useEffect} from 'react';
import Link from 'next/link';
import {collection,query,where,orderBy,onSnapshot} from 'firebase/firestore';
import {db} from '@/lib/firebase';
import {useStore} from '@/lib/store';

const CAT_EMOJIS:Record<string,string>={
  FROZEN:'❄️',
  'SOFT DRINKS':'🥤',
  DRINKS:'🥤',
  BEVERAGE:'🧃',
  DRY:'🌾',
  RUNCHIT:'🛒',
  SPICES:'🌶️',
  FRESH:'🥦',
  FRUITS:'🍎',
  COSMETICS:'✨',
  TOBACCO:'🍂',
  MINYAK:'🛢️',
  BEEF:'🥩',
  MUTTON:'🐑',
  FISH:'🐟',
  POULTRY:'🐔',
  GENERAL:'📦'
};

function BannerCarousel(){
  const [banners,setBanners]=useState<any[]>([]);
  const [idx,setIdx]=useState(0);
  useEffect(()=>{
    return onSnapshot(
      query(collection(db,'banners'),where('active','==',true),orderBy('order','asc')),
      s=>setBanners(s.docs.map(d=>({id:d.id,...d.data()})))
    );
  },[]);
  useEffect(()=>{
    if(banners.length<=1)return;
    const t=setInterval(()=>setIdx(i=>(i+1)%banners.length),5000);
    return ()=>clearInterval(t);
  },[banners.length]);
  if(banners.length===0)return null;
  return(
    <div className="relative mb-4 overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="relative aspect-[3/1] sm:aspect-[4/1] w-full">
        {banners.map((b,i)=>(
          <img
            key={b.id}
            src={b.imageUrl}
            alt={b.title||'Promotion'}
            className={'absolute inset-0 h-full w-full object-cover transition-opacity duration-700 '+(i===idx?'opacity-100':'opacity-0')}
          />
        ))}
      </div>
      {banners.length>1&&(
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
          {banners.map((_,i)=>(
            <button key={i} onClick={()=>setIdx(i)}
              className={'h-2 rounded-full transition-all '+(i===idx?'w-6 bg-white shadow':'w-2 bg-white/60')}
            />
          ))}
        </div>
      )}
      {banners.length>1&&(
        <>
          <button onClick={()=>setIdx(i=>(i-1+banners.length)%banners.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 px-2 py-1 text-white hover:bg-black/50 text-lg">‹</button>
          <button onClick={()=>setIdx(i=>(i+1)%banners.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 px-2 py-1 text-white hover:bg-black/50 text-lg">›</button>
        </>
      )}
    </div>
  );
}

export default function Home(){
  const {products,price,stockState,setQty,cart,settings,role}=useStore();
  const [q,setQ]=useState('');const [cat,setCat]=useState('');

  useEffect(()=>{
    if(typeof window==='undefined')return;
    const params=new URLSearchParams(window.location.search);
    const initialCat=params.get('cat')||'';
    const initialQ=params.get('q')||'';
    if(initialCat)setCat(initialCat);
    if(initialQ)setQ(initialQ);

    const onPopState=()=>{
      const p=new URLSearchParams(window.location.search);
      setCat(p.get('cat')||'');
      setQ(p.get('q')||'');
    };
    window.addEventListener('popstate',onPopState);
    return ()=>window.removeEventListener('popstate',onPopState);
  },[]);

  function selectCategory(newCat:string){
    setCat(newCat);
    const params=new URLSearchParams(window.location.search);
    if(newCat) params.set('cat',newCat);
    else params.delete('cat');
    const newUrl=window.location.pathname+(params.toString()?`?${params.toString()}`:'');
    window.history.pushState(null,'',newUrl);
  }

  const categories=useMemo(()=>{
    const set=new Set<string>();
    products.forEach(p=>{if(p.category&&p.status!=='hidden') set.add(p.category.trim())});
    return Array.from(set).sort((a,b)=>a.localeCompare(b));
  },[products]);

  const list=products.filter(p=>p.status!=='hidden'&&(!cat||p.category.toLowerCase()===cat.toLowerCase())&&(p.name+p.sku).toLowerCase().includes(q.toLowerCase()));
  return <>
    <BannerCarousel/>
    <div className="mb-3 flex flex-col sm:flex-row gap-2">
      <input className="inp flex-1" placeholder="Search by name or SKU" value={q} onChange={e=>{
        const val=e.target.value;
        setQ(val);
        const params=new URLSearchParams(window.location.search);
        if(val) params.set('q',val);
        else params.delete('q');
        const newUrl=window.location.pathname+(params.toString()?`?${params.toString()}`:'');
        window.history.replaceState(null,'',newUrl);
      }} aria-label="Search products"/>

      <div className="sm:w-64 shrink-0">
        <select
          className="inp cursor-pointer font-medium bg-white"
          value={cat}
          onChange={e=>selectCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">📂 All Categories ({products.filter(p=>p.status!=='hidden').length})</option>
          {categories.map(c=>{
            const emoji=CAT_EMOJIS[c.toUpperCase()]||'📦';
            const count=products.filter(p=>p.status!=='hidden'&&p.category.toLowerCase()===c.toLowerCase()).length;
            return (
              <option key={c} value={c}>
                {emoji} {c} ({count})
              </option>
            );
          })}
        </select>
      </div>
    </div>

    <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
      <button
        onClick={()=>selectCategory('')}
        className={'whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors '+(cat===''?'border-ink bg-ink text-white':'border-line bg-white text-ink/80 hover:border-ink/50')}
      >
        All ({products.filter(p=>p.status!=='hidden').length})
      </button>
      {categories.map(c=>{
        const emoji=CAT_EMOJIS[c.toUpperCase()]||'📦';
        const count=products.filter(p=>p.status!=='hidden'&&p.category.toLowerCase()===c.toLowerCase()).length;
        return (
          <button
            key={c}
            onClick={()=>selectCategory(c)}
            className={'whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors '+(cat.toLowerCase()===c.toLowerCase()?'border-ink bg-ink text-white':'border-line bg-white text-ink/80 hover:border-ink/50')}
          >
            {emoji} {c} ({count})
          </button>
        );
      })}
    </div>
    {list.length===0&&<p className="py-16 text-center text-ink/60">No products match. Try another search or category.</p>}
    <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {list.map(p=>{
        const s=stockState(p);
        const hasPromo=role==='customer'&&p.promoPrice&&p.promoPrice>0&&p.promoPrice<p.retailPrice;
        return(
          <article key={p.id} className={'flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm hover:border-ink/30 transition-colors '+(hasPromo?'border-red-300 ring-1 ring-red-200':'border-line')}>
            <Link href={`/product?id=${p.id}${cat?`&cat=${encodeURIComponent(cat)}`:''}`} className="group relative flex aspect-square w-full items-center justify-center overflow-hidden bg-white p-2 sm:p-3 border-b border-line">
              {hasPromo&&<span className="absolute top-1 left-1 z-[1] rounded bg-red-500 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold text-white shadow">SALE</span>}
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                  onError={(e)=>{(e.target as HTMLElement).style.display='none';}}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded bg-frost text-2xl sm:text-3xl text-ink/30">📦</div>
              )}
            </Link>
            <div className="flex flex-1 flex-col justify-between gap-1 p-2 sm:p-2.5">
              <div>
                <h2 className="text-[11px] sm:text-sm font-semibold leading-tight line-clamp-2 min-h-[1.75rem] sm:min-h-[2.25rem]" title={p.name}>
                  {p.name}
                </h2>
                {hasPromo?(
                  <div className="mt-0.5">
                    <p className="text-[9px] sm:text-xs text-ink/50 line-through leading-none">
                      {settings.currency}{p.retailPrice.toFixed(2)}
                    </p>
                    <p className="text-xs sm:text-base font-extrabold text-red-600 leading-none">
                      {settings.currency}{p.promoPrice!.toFixed(2)}
                      <span className="text-[9px] sm:text-xs font-normal text-ink/60">/{p.unit}</span>
                    </p>
                  </div>
                ):(
                  <div>
                    <p className="mt-0.5 text-xs sm:text-base font-extrabold text-ink leading-none">
                      {settings.currency}{price(p).toFixed(2)}
                      <span className="text-[9px] sm:text-xs font-normal text-ink/60">/{p.unit}</span>
                    </p>
                    {Array.isArray(p.priceSlabs) && p.priceSlabs.length>0 && (
                      <p className="text-[9px] sm:text-[10px] text-blue-700 font-semibold leading-tight mt-0.5">
                        Bulk from {settings.currency}{Math.min(...p.priceSlabs.map(s=>s.price)).toFixed(2)}
                      </p>
                    )}
                  </div>
                )}
                <p className={'mt-0.5 text-[9px] sm:text-xs font-medium '+(s==='In Stock'?'text-brine':s==='Low Stock'?'text-amber-700':'text-label')}>
                  {s}
                </p>
              </div>
              <button
                className="btn mt-1.5 w-full text-[10px] sm:text-xs py-1 px-1 sm:py-2 sm:px-3 font-semibold rounded truncate"
                disabled={s==='Out Of Stock'}
                onClick={()=>setQty(p.id,(cart[p.id]||0)+1)}
                title={cart[p.id]?`In cart: ${cart[p.id]}`:'Add to cart'}
              >
                {cart[p.id]?`In cart (${cart[p.id]})`:'Add to cart'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  </>;
}
