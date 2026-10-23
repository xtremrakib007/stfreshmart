# Firebase App Check rollout

## Current code behavior

The browser client can initialize Firebase App Check with the reCAPTCHA v3 provider when
`NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY` is configured at build time. The setting is optional
so existing deployments do not silently break before the site key is configured.

The `createOrder` callable currently has App Check enforcement disabled by default. It supports explicit opt-in using the Functions environment variable `ENFORCE_CHECKOUT_APP_CHECK=true`. Do not set this variable
to `enforceAppCheck: true` until the web app is registered in Firebase Console, the matching
reCAPTCHA v3 site key is supplied to the production build, and real checkout requests have
been verified with App Check tokens.

## Safe enablement checklist

1. In Firebase Console, open App Check and register the exact Firebase web app used by ST Freshmart.
2. Configure the reCAPTCHA v3 provider and use its **site key** as `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY`. Never put a reCAPTCHA secret key in a `NEXT_PUBLIC_` variable.
3. Build and test the web client against the Firebase Emulator/staging project. Verify App Check initializes without browser console errors and checkout still works.
4. Deploy the client only after the correct site key is configured.
5. In production, monitor App Check request metrics for the callable before enabling enforcement.
6. Set `ENFORCE_CHECKOUT_APP_CHECK=true` for the callable deployment only after legitimate traffic is receiving valid tokens; otherwise leave it unset or false. Re-test guest checkout and staff workflows after the enforcement change.

## Important limitation

This repository change only prepares the client for App Check. It does not register providers in Firebase Console, change production enforcement, deploy hosting/functions, or prove that production traffic is attested.
