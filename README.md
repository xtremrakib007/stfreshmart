# Sairah Trading Sdn Bhd, Perak: Wholesale Ordering

## Go-live steps
1. Create a Firebase project. Set Firestore and Storage location to `asia-southeast1` (Singapore, closest to Perak). Enable Email/Password sign-in. Upgrade to Blaze (Cloud Functions needs it; costs depend on usage).
2. Install dependencies: `npm i` and `cd functions && npm i && cd ..`. Copy `.env.example` to `.env.local` and fill in the web app keys.
3. Select the Firebase project with `firebase use --add`, then run `npm run build` and `firebase deploy --only functions,hosting,storage`. **Do not deploy Firestore rules yet**; migrate legacy private-price fields first.
4. Create the first admin manually: add a user in Firebase Authentication, then create `users/<uid>` with `{name, email, role:"admin", active:true}`. Sign in as this administrator.
5. Back up/export Firestore in the Firebase Console. Open Admin > Products, run “Migrate legacy private price fields”, and verify the reported counts plus sample product documents.
6. Only after the migration succeeds, deploy hardened Firestore rules: `firebase deploy --only firestore:rules`.
7. Verify customer checkout, staff order workflow, admin product editing, and that customer/staff accounts cannot read `productPrivate` documents.
8. Open Admin > Settings to set the company name, logo and WhatsApp number (for example, `60123456789`).
9. Use Admin > Import to upload the Excel price list, then add product photos in Admin > Products.

## How it is secured
- Staff prices are in `staffPrices/{sku}`; rules allow only active staff/admin to read them.
- Customers can read active product documents; private cost and minimum-price values belong in the admin-only `productPrivate/{sku}` collection.
- Orders must be created through the `createOrder` Cloud Function, which recalculates prices and checks stock before saving.
- Order status transitions and stock deduction/restoration are handled by the trusted `updateOrderStatus` Cloud Function; direct client order updates are denied.
- Product create/update/delete operations are admin-only. Inventory history is written by trusted functions, not directly by clients.
- Staff accounts are created by Cloud Functions, never from the browser.
- Product image uploads are limited to active admins and files under 5 MB.
- Staff order workflow transitions are validated server-side; direct client order creation and updates are denied.

## Known limits / before production
- Deployment/migration sequence matters: deploy the callable and admin UI, sign in as an administrator, use Admin > Products > “Migrate legacy private price fields”, verify completion, and only then deploy the hardened Firestore rules. Until migration completes, legacy fields in existing product documents may still be readable by clients. Back up Firestore first.
- The migration is admin-only and safe to rerun, but verify the reported counts and sample documents before tightening rules.
- Stock is checked at order submission and atomically rechecked/deducted when staff accepts the order. Stock is not reserved at submission time, so orders can be rejected at acceptance if another order uses the stock first.
- Order alerts are in-app (sound, badge, tab title) while the admin page is open. No push or email yet.
- Run build, function checks, and Firebase Emulator security-rule tests before deploying.
