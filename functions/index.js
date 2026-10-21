const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');const crypto=require('crypto');
admin.initializeApp();const opt={region:'asia-southeast1'};
async function guard(req){
  if(!req.auth)throw new HttpsError('unauthenticated','Log in first.');
  const s=await admin.firestore().doc(`users/${req.auth.uid}`).get();
  if(!s.exists||s.data().role!=='admin'||!s.data().active)throw new HttpsError('permission-denied','Admins only.');
}
exports.createStaff=onCall(opt,async req=>{await guard(req);
  const {name,email,phone='',role}=req.data||{};
  if(!name||!email||!['staff','admin'].includes(role))throw new HttpsError('invalid-argument','Name, email and role are required.');
  const u=await admin.auth().createUser({email,displayName:name,password:crypto.randomBytes(16).toString('base64url')});
  await admin.firestore().doc(`users/${u.uid}`).set({name,email,phone,role,active:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  return {uid:u.uid,link:await admin.auth().generatePasswordResetLink(email)};
});
exports.setStaffActive=onCall(opt,async req=>{await guard(req);
  const {uid,active}=req.data||{};if(uid===req.auth.uid)throw new HttpsError('failed-precondition','You cannot disable your own account.');
  await admin.auth().updateUser(uid,{disabled:!active});await admin.firestore().doc(`users/${uid}`).update({active:!!active});return {ok:true};
});
exports.resetStaffPassword=onCall(opt,async req=>{await guard(req);
  const u=await admin.auth().getUser(req.data.uid);return {link:await admin.auth().generatePasswordResetLink(u.email)};
});
