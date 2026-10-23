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
10. After deploying Functions, verify the `expireStockReservations` Cloud Scheduler job exists and its executions succeed. It should run every 10 minutes in `Asia/Kuala_Lumpur`; this scheduled job cancels pending orders whose stock reservation has expired and releases the reserved stock. Confirm this in Cloud Scheduler and Cloud Logging rather than assuming deployment succeeded.
11. Configure and test Firebase App Check for the production web app before setting `ENFORCE_CHECKOUT_APP_CHECK=true` in the Functions environment. Enforcement is opt-in and remains disabled unless the value is exactly `true`. Verify legitimate customer checkout first after enabling it.

## How it is secured
- Staff prices are in `staffPrices/{sku}`; rules allow only active staff/admin to read them.
- Customers can read active product documents; private cost and minimum-price values belong in the admin-only `productPrivate/{sku}` collection.
- Orders must be created through the `createOrder` Cloud Function, which recalculates prices and reserves stock atomically before saving the pending order.
- Each pending checkout reserves available stock immediately. Staff acceptance consumes that reservation without deducting stock twice; cancellation restores stock. Reservations expire after 60 minutes and are released by the scheduled `expireStockReservations` function.
- Order status transitions, stock reservation/release, and inventory movement history are handled by trusted server-side Functions; direct client order mutations are denied.
- Product create/update/delete operations are admin-only. Inventory history is written by trusted functions, not directly by clients.
- Staff accounts are created by Cloud Functions, never from the browser.
- Product image uploads are limited to active admins and files under 5 MB.
- Staff order workflow transitions are validated server-side; direct client order creation and updates are denied.

## Known limits / before production
- Deployment/migration sequence matters: deploy the callable and admin UI, sign in as an administrator, use Admin > Products > “Migrate legacy private price fields”, verify completion, and only then deploy the hardened Firestore rules. Until migration completes, legacy fields in existing product documents may still be readable by clients. Back up Firestore first.
- The migration is admin-only and safe to rerun, but verify the reported counts and sample documents before tightening rules.
- The reservation expiry scheduler requires a successful Functions deployment and a working Cloud Scheduler job. Confirm scheduler execution and inspect logs before relying on automatic stock release; do not assume a passing CI run means production has been deployed.
- Firebase App Check enforcement for checkout is intentionally disabled by default until the production web app is registered, attested, and tested. Do not enable enforcement before validating the legitimate customer flow.
- Order alerts are in-app (sound, badge, tab title) while the admin page is open. No push or email yet.
- Run build, function checks, and Firebase Emulator security-rule tests before deploying.

## Tests
- Source checks: `cd functions && npm run test:security`.
- Emulator tests (Firestore rules, Storage rules and all Cloud Functions against the Firebase Emulator Suite): `cd emulator-tests && npm install && npm test`. Requires Node 22 and Java 11+. Uses the offline `demo-stfreshmart` project, so no real Firebase data is touched.
- Behind an HTTP(S) proxy, the Firebase CLI routes the Storage emulator's Firestore lookups through the proxy, so the admin image-upload test is skipped there. Run without a proxy to cover it.
