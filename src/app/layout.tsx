import './globals.css';
import {Bricolage_Grotesque} from 'next/font/google';
import Link from 'next/link';
import {Providers} from '@/lib/store';
import {Nav} from './nav';
const f=Bricolage_Grotesque({subsets:['latin'],variable:'--font'});
export const metadata={title:'Sairah Trading Sdn Bhd | Wholesale Ordering',description:'Wholesale meat, fish, poultry and drinks in Perak'};
export default function Root({children}:{children:React.ReactNode}){
  return <html lang="en"><body className={f.variable+' font-sans'}><Providers><Nav/><main className="mx-auto max-w-6xl px-4 pb-16 pt-4">{children}</main><footer className="border-t border-line py-6 text-center text-sm text-ink/60">Sairah Trading Sdn Bhd, Perak, Malaysia</footer></Providers></body></html>;
}
