'use client';
import {useEffect,useState} from 'react';
import {collection,onSnapshot} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {db,fns} from '@/lib/firebase';
const call=(n:string,d:any)=>httpsCallable<any,any>(fns,n)(d).then(r=>r.data);
export function Staff(){
  const [users,setUsers]=useState<any[]>([]);const [f,setF]=useState({name:'',email:'',phone:'',role:'staff'});const [msg,setMsg]=useState('');const [link,setLink]=useState('');
  useEffect(()=>onSnapshot(collection(db,'users'),s=>setUsers(s.docs.map(d=>({id:d.id,...d.data()})))),[]);
  const run=async(fn:()=>Promise<any>)=>{setMsg('');setLink('');try{const r=await fn();if(r?.link){setLink(r.link);setMsg('Send this link to the staff member so they can set a password.')}}catch(e:any){setMsg(e.message||'Something went wrong.')}};
  return <div className="grid gap-6 md:grid-cols-2"><div className="space-y-2"><h2 className="font-bold">Add staff account</h2>
    {(['name','email','phone'] as const).map(k=><input key={k} className="inp" placeholder={k} value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})}/>)}
    <select className="inp" value={f.role} onChange={e=>setF({...f,role:e.target.value})}><option value="staff">Staff</option><option value="admin">Admin</option></select>
    <button className="btn" onClick={()=>run(async()=>{const r=await call('createStaff',f);setF({name:'',email:'',phone:'',role:'staff'});return r})}>Create account</button>
    {msg&&<p role="status" className="text-sm">{msg}</p>}{link&&<textarea readOnly className="inp h-24" value={link} onFocus={e=>e.target.select()}/>}</div>
    <ul className="divide-y divide-line rounded-lg border border-line bg-white">{users.map(u=><li key={u.id} className="flex items-center gap-2 p-3 text-sm"><span className="flex-1">{u.name} · {u.email} · {u.role}{!u.active&&' (disabled)'}</span>
      <button className="underline" onClick={()=>run(()=>call('resetStaffPassword',{uid:u.id}))}>Reset password</button>
      <button className="underline" onClick={()=>run(()=>call('setStaffActive',{uid:u.id,active:!u.active}))}>{u.active?'Disable':'Enable'}</button></li>)}</ul></div>;
}
