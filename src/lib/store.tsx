'use client';
import {createContext,useContext,useEffect,useMemo,useState,ReactNode} from 'react';
import {onAuthStateChanged,User} from 'firebase/auth';
import {collection,doc,getDoc,onSnapshot,query,where} from 'firebase/firestore';
import {auth,db} from './firebase';
import type {Product,Role,Settings} from './types';
const DEF:Settings={companyName:'Sairah Trading Sdn Bhd',whatsappNumber:'',lowStockThreshold:10,currency:'RM'};
type Cart=Record<string,number>;
interface Ctx{user:User|null;role:Role;products:Product[];settings:Settings;cart:Cart;price:(p:Product,qty?:number)=>number;
  stockState:(p:Product)=>'In Stock'|'Low Stock'|'Out Of Stock';setQty:(id:string,q:number)=>void;clear:()=>void;count:number;}
const C=createContext<Ctx>(null as any);
export const useStore=()=>useContext(C);
export function Providers({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(null);const [role,setRole]=useState<Role>('customer');
  const [products,setProducts]=useState<Product[]>([]);const [staff,setStaff]=useState<Record<string,number>>({});
  const [settings,setSettings]=useState<Settings>(DEF);const [cart,setCart]=useState<Cart>({});
  useEffect(()=>{try{setCart(JSON.parse(localStorage.getItem('fh-cart')||'{}'))}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem('fh-cart',JSON.stringify(cart))}catch{}},[cart]);
  useEffect(()=>onAuthStateChanged(auth,async u=>{setUser(u);setRole('customer');
    if(u){const s=await getDoc(doc(db,'users',u.uid));const d=s.data();if(s.exists()&&d?.active)setRole(d.role)}}),[]);
  useEffect(()=>onSnapshot(role==='admin'?collection(db,'products'):query(collection(db,'products'),where('status','==','active')),s=>setProducts(s.docs.map(d=>{
    const data = d.data();
    if(role!=='admin'){
      delete data.purchasePrice;
      delete data.minPricePcs;
      delete data.minPriceCtn;
    }
    return {id:d.id,...data} as Product;
  }))),[role]);
  useEffect(()=>onSnapshot(doc(db,'settings','main'),s=>s.exists()&&setSettings({...DEF,...s.data()} as Settings)),[]);
  useEffect(()=>{if(role==='customer'){setStaff({});return}
    return onSnapshot(collection(db,'staffPrices'),s=>{const m:Record<string,number>={};s.docs.forEach(d=>m[d.id]=d.data().price);setStaff(m)})},[role]);
  const v=useMemo<Ctx>(()=>({user,role,products,settings,cart,
    price:(p,q)=>{
      if(role!=='customer'&&staff[p.id]!=null) return staff[p.id];
      const quantity = q ?? (cart[p.id] || 1);
      if(Array.isArray(p.priceSlabs) && p.priceSlabs.length>0){
        const sorted = [...p.priceSlabs].filter(s=>s.minQty>0&&s.price>0).sort((a,b)=>b.minQty-a.minQty);
        const match = sorted.find(s=>quantity>=s.minQty);
        if(match) return match.price;
      }
      if(p.promoPrice&&p.promoPrice>0) return p.promoPrice;
      return p.retailPrice;
    },
    stockState:p=>p.stock<=0?'Out Of Stock':p.stock<=settings.lowStockThreshold?'Low Stock':'In Stock',
    setQty:(id,q)=>setCart(c=>{const n={...c};if(q<=0)delete n[id];else n[id]=q;return n}),
    clear:()=>setCart({}),count:Object.keys(cart).length}),[user,role,products,settings,cart,staff]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
