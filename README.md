# Sairah Trading Sdn Bhd, Perak: Wholesale Ordering

## Go-live steps
1. Create a Firebase project. Set Firestore and Storage location to `asia-southeast1` (Singapore, closest to Perak). Enable Email/Password sign-in. Upgrade to Blaze (Cloud Functions needs it; light use costs very little).
2. `npm i` and `cd functions && npm i && cd ..`. Copy `.env.example` to `.env.local` and fill in the web app keys.
3. `firebase use --add`, then `npm run deploy` (builds the site and deploys hosting, Firestore rules, Storage rules and functions).
4. Create the first admin by hand: add a user in Firebase Auth, then a Firestore doc `users/<uid>` with `{name, email, role:"admin", active:true}`. After that, add all other staff from Admin > Staff.
5. Open Admin > Settings: set company name, logo and WhatsApp number (e.g. 60123456789).
6. Admin > Import: upload your Excel price list. Then add photos in Admin > Products.

## How it is secured
- Staff prices are in `staffPrices/{sku}`; rules allow only active staff/admin to read them.
- Customers can only read active products and create Pending orders. All edits need an active admin.
- Staff accounts are created by Cloud Functions, never from the browser.
- Hosting sends security headers; Storage accepts admin image uploads under 5 MB only.

## Known limits
- Order prices come from the browser. Admin should check totals on the order before accepting.
- Order alerts are in-app (sound, badge, tab title) while the admin page is open. No push or email yet.
