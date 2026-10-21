'use client';
import {useState} from 'react';
import {signInWithEmailAndPassword} from 'firebase/auth';
import {auth} from '@/lib/firebase';
export default function Login(){
  const [e,setE]=useState('');const [p,setP]=useState('');const [err,setErr]=useState('');
  const go=async()=>{try{await signInWithEmailAndPassword(auth,e,p);window.location.href='/'}catch{setErr('Email or password is wrong.')}};
  return <div className="mx-auto max-w-sm space-y-3 py-10"><h1 className="text-2xl font-bold">Staff login</h1>
    <input className="inp" type="email" placeholder="Email" value={e} onChange={x=>setE(x.target.value)}/>
    <input className="inp" type="password" placeholder="Password" value={p} onChange={x=>setP(x.target.value)}/>
    {err&&<p role="alert" className="text-sm text-label">{err}</p>}<button className="btn w-full" onClick={go}>Log in</button></div>;
}
