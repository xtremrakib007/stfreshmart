import {initializeApp,getApps,type FirebaseApp} from 'firebase/app';
import {getAuth,type Auth} from 'firebase/auth';
import {getFirestore,type Firestore} from 'firebase/firestore';
import {getStorage,type FirebaseStorage} from 'firebase/storage';
import {getFunctions,type Functions} from 'firebase/functions';

// Guard: Firebase only initialises on the client.
// During Next.js static-export prerendering (server/Node), exports are null.
// This is safe because every call site is inside useEffect or an event handler.
let app: FirebaseApp | null = null;
if (typeof window !== 'undefined') {
  app = getApps()[0] ?? initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FB_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FB_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FB_APP_ID,
  });
}
export const auth = app ? getAuth(app) : (null as unknown as Auth);
export const db = app ? getFirestore(app) : (null as unknown as Firestore);
export const storage = app ? getStorage(app) : (null as unknown as FirebaseStorage);
export const fns = app ? getFunctions(app, 'asia-southeast1') : (null as unknown as Functions);
