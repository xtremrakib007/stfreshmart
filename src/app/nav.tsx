'use client';
import Link from 'next/link';
import {signOut} from 'firebase/auth';
import {auth} from '@/lib/firebase';
import {useStore} from '@/lib/store';
export function Nav(){
  const {settings,role,count,user}=useStore();
  return <header className="sticky top-0 z-10 border-b border-line bg-frost/95 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
    <Link href="/" className="flex items-center gap-2 text-base font-extrabold tracking-tight sm:text-xl"><img src={settings.logoUrl||'/logo.png'} alt="" className="h-8 sm:h-9 object-contain"/>{settings.companyName}</Link>
    <nav className="flex items-center gap-3 text-sm">
      {role!=='customer'&&<span className="rounded bg-brine px-2 py-0.5 text-xs font-semibold text-white">Staff prices</span>}
      {role!=='customer'&&<Link href="/admin" className="font-semibold text-ink/80 hover:text-ink">{role==='admin'?'Admin':'Orders'}</Link>}
      {user?<button onClick={()=>signOut(auth)}>Log out</button>:<Link href="/login">Staff login</Link>}
      <Link href="/cart" className="btn">Cart ({count})</Link></nav></div></header>;
}
