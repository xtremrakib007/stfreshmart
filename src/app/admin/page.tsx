'use client';
import {useEffect,useRef,useState} from 'react';
import {collection,onSnapshot,orderBy,query,limit} from 'firebase/firestore';
import {db} from '@/lib/firebase';
import {useStore} from '@/lib/store';
import {Products} from './products';import {InventoryHistory} from './inventory-history';import {Orders} from './orders';import {Staff} from './staff';import {ImportTab} from './import';import {SettingsTab} from './settings';

function beep(){try{const a=new AudioContext(),o=a.createOscillator();o.connect(a.destination);o.frequency.value=880;o.start();o.stop(a.currentTime+0.25)}catch{}}
export default function Admin(){
  const {role,products,settings}=useStore();
  const [tab,setTab]=useState('Orders');
  const [orders,setOrders]=useState<any[]>([]);
  const prev=useRef<number|null>(null);

  useEffect(()=>{
    if(role==='admin'||role==='staff'){
      return onSnapshot(query(collection(db,'orders'),orderBy('createdAt','desc'),limit(300)),s=>setOrders(s.docs.map(d=>({id:d.id,...d.data()}))));
    }
  },[role]);

  const pending=orders.filter(o=>o.status==='Pending').length;
  useEffect(()=>{if(prev.current!==null&&pending>prev.current)beep();prev.current=pending;document.title=pending?`(${pending}) New orders`:role==='admin'?'Admin':'Orders';},[pending,role]);

  if(role==='customer')return <p className="py-16 text-center">Staff and admins only. Log in with your staff account.</p>;

  const TABS = role==='admin' ? ['Dashboard','Products','Orders','Inventory','Staff','Import','Settings'] : ['Orders','Dashboard','Products','Inventory'];
  const today=new Date().toDateString();
  const stat=[['New orders',pending],['Orders today',orders.filter(o=>o.createdAt?.toDate?.().toDateString()===today).length],['Low stock',products.filter(p=>p.stock>0&&p.stock<=settings.lowStockThreshold).length],['Out of stock',products.filter(p=>p.stock<=0).length]];

  return <div><div className="mb-4 flex gap-2 overflow-x-auto">{TABS.map(t=><button key={t} onClick={()=>setTab(t)} className={tab===t?'btn':'btn-alt'}>{t}{t==='Orders'&&pending>0&&` (${pending})`}</button>)}</div>
    {tab==='Dashboard'&&<div className="grid grid-cols-2 gap-3 md:grid-cols-4">{stat.map(([l,n])=><div key={l as string} className="rounded-lg border border-line bg-white p-4"><p className="text-3xl font-bold">{n}</p><p className="text-sm text-ink/60">{l}</p></div>)}</div>}
    {tab==='Products'&&<Products/>}{tab==='Orders'&&<Orders orders={orders}/>}{tab==='Inventory'&&<InventoryHistory/>}{tab==='Staff'&&role==='admin'&&<Staff/>}{tab==='Import'&&role==='admin'&&<ImportTab/>}{tab==='Settings'&&role==='admin'&&<SettingsTab/>}</div>;
}
