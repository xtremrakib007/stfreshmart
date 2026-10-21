import Link from 'next/link';
export default function NotFound(){
  return <div className="py-20 text-center">
    <h1 className="text-4xl font-extrabold">404</h1>
    <p className="mt-2 text-ink/60">The page you're looking for doesn't exist.</p>
    <Link href="/" className="btn mt-6 inline-block">Back to catalog</Link>
  </div>;
}
