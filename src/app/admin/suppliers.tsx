'use client';
import {useEffect,useState} from 'react';
import {collection,onSnapshot,orderBy,query} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {db,fns} from '@/lib/firebase';

type Supplier={id:string;name:string;contactName?:string;phone?:string;email?:string;address?:string;notes?:string;active?:boolean};
const empty={name:'',contactName:'',phone:'',email:'',address:'',notes:'',active:true};
export function Suppliers(){
  const [items,setItems]=useState<Supplier[]>([]);
  const [form,setForm]=useState<any>(empty);
  const [editing,setEditing]=useState('');
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);
  useEffect(()=>onSnapshot(query(collection(db,'suppliers'),orderBy('name')),snap=>setItems(snap.docs.map(d=>({id:d.id,...d.data()} as Supplier))),()=>setMessage('Could not load suppliers. Check your staff access and connection.')),[]);
  function startEdit(s?:Supplier){
    setEditing(s?.id||'');
    setForm(s?{name:s.name||'',contactName:s.contactName||'',phone:s.phone||'',email:s.email||'',address:s.address||'',notes:s.notes||'',active:s.active!==false}:{...empty});
    setMessage('');
  }
  async function save(e:any){
    e.preventDefault();setSaving(true);setMessage('');
    try{
      const saveSupplier=httpsCallable(fns,'saveSupplier');
      await saveSupplier({...form,...(editing?{supplierId:editing}:{})});
      setMessage(editing?'Supplier updated.':'Supplier added.');
      startEdit();
    }catch(err:any){setMessage(err?.message||'Could not save supplier.');}
    finally{setSaving(false);}
  }
  const field=(key:string,label:string,type='text')=><label className="block text-sm">{label}<input className="mt-1 w-full rounded border border-line p-2" type={type} maxLength={key==='notes'?2000:key==='address'?500:key==='email'?254:key==='name'?160:120} value={form[key]??''} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
  return <div className="space-y-5">
    <div><h2 className="text-xl font-bold">Suppliers</h2><p className="text-sm text-ink/60">Maintain supplier contacts for purchasing and stock receiving.</p></div>
    <form onSubmit={save} className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-2">
      <div className="md:col-span-2"><h3 className="font-semibold">{editing?'Edit supplier':'Add supplier'}</h3></div>
      {field('name','Supplier name')}
      {field('contactName','Contact person')}
      {field('phone','Phone')}
      {field('email','Email','email')}
      <div className="md:col-span-2">{field('address','Address')}</div>
      <div className="md:col-span-2">{field('notes','Notes')}</div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Active supplier</label>
      <div className="flex gap-2"><button className="btn" disabled={saving||!form.name.trim()}>{saving?'Saving…':editing?'Save changes':'Add supplier'}</button>{editing&&<button type="button" className="btn-alt" onClick={()=>startEdit()}>Cancel</button>}</div>
      {message&&<p className="text-sm md:col-span-2" role="status">{message}</p>}
    </form>
    <div className="overflow-x-auto rounded-lg border border-line"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50"><th className="p-3">Supplier</th><th className="p-3">Contact</th><th className="p-3">Phone / email</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>
      {items.map(s=><tr key={s.id} className="border-b last:border-0"><td className="p-3"><div className="font-medium">{s.name}</div>{s.address&&<div className="text-xs text-ink/60">{s.address}</div>}</td><td className="p-3">{s.contactName||'—'}</td><td className="p-3">{s.phone||'—'}<div className="text-xs text-ink/60">{s.email||''}</div></td><td className="p-3">{s.active===false?'Inactive':'Active'}</td><td className="p-3"><button className="btn-alt" onClick={()=>startEdit(s)}>Edit</button></td></tr>)}
      {!items.length&&<tr><td colSpan={5} className="p-6 text-center text-ink/60">No suppliers yet. Add your first supplier above.</td></tr>}
    </tbody></table></div>
  </div>;
}
