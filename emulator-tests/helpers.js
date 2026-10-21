'use strict';
// Shared helpers for emulator tests. Run through `npm test`, which starts the
// emulators and sets FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST.
const admin=require('firebase-admin');

const PROJECT_ID='demo-stfreshmart';
const REGION='asia-southeast1';
const AUTH_HOST=process.env.FIREBASE_AUTH_EMULATOR_HOST||'127.0.0.1:9099';
const FIRESTORE_HOST=process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8080';
const FUNCTIONS_HOST='127.0.0.1:5001';
const PASSWORD='test-password-123';

if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error('Emulators are not running. Use `npm test` in emulator-tests/.');

const app=admin.apps.length?admin.app():admin.initializeApp({projectId:PROJECT_ID});
const db=app.firestore();
const auth=app.auth();

async function resetEmulators(){
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,{method:'DELETE'});
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,{method:'DELETE'});
}

// Creates an Auth account (and optionally a users/{uid} profile) and returns its ID token.
async function createUser(uid,profile){
  const email=`${uid}@example.test`.toLowerCase();
  await auth.createUser({uid,email,password:PASSWORD});
  if(profile)await db.doc(`users/${uid}`).set({name:uid,email,...profile});
  const res=await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password:PASSWORD,returnSecureToken:true})
  });
  const body=await res.json();
  if(!body.idToken)throw new Error(`Sign-in failed for ${uid}: ${JSON.stringify(body)}`);
  return body.idToken;
}

// Calls an onCall function using the callable HTTP protocol.
// Returns {result} on success or {error:{status,message}} on failure.
async function call(name,data,token){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization=`Bearer ${token}`;
  const res=await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${name}`,{
    method:'POST',headers,body:JSON.stringify({data})
  });
  return res.json();
}

module.exports={PROJECT_ID,admin,db,auth,resetEmulators,createUser,call};
