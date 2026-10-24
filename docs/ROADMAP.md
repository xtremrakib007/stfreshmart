# ST Freshmart — Complete Wholesale Business Roadmap

Repository: `xtremrakib007/stfreshmart`  
Current architecture: Next.js 14 / React / TypeScript, Firebase Authentication, Cloud Firestore, Cloud Storage, and Cloud Functions.  
Delivery principle: extend the existing application; redesign only when a documented technical limitation makes incremental improvement unsafe or materially more expensive.

## Goals

- Give wholesale customers a fast, dependable way to browse approved products, place orders, and repeat purchases.
- Give staff a controlled workflow for accepting, picking, packing, dispatching, and completing orders.
- Give management accurate stock, purchasing, customer-account, sales, and margin information.
- Protect private costs, customer data, pricing rules, stock, and administrative actions.
- Keep production unchanged until changes have passed the relevant checks and have an explicit deployment plan.

## Existing capabilities to preserve and improve

The repository already includes product/SKU/category and image management, product visibility, wholesale price tiers and promotions, cart/checkout, delivery and self-pickup choices, order status workflow, inventory history, staff/admin accounts, WhatsApp ordering, Excel product/price import, settings, and printable pre-invoices. It also contains Cloud Functions, Firestore and Storage rules, source-level security regression tests, and Firebase Emulator tests.

Do not build duplicate screens or services for these capabilities. First map each proposal to the current implementation and improve the existing path where possible.

## Phase 0 — Audit, security, and release readiness (P0)

### Work
- Review the current `main` branch and the existing `security/wholesale-order-hardening` branch/changes; identify which protections are already present and avoid reapplying them.
- Verify the required migration sequence for legacy private product prices, including a Firestore backup, migration count checks, and sample-document verification before deploying restrictive rules.
- Audit every client read/write and callable function for active-user checks, role checks, ownership, input validation, and least privilege.
- Confirm purchase cost, minimum selling prices, and staff-only prices cannot be read from customer-facing product documents or exposed through client types, API responses, logs, or exports.
- Verify that order creation calculates prices and totals on trusted server code; validate product status, quantities, duplicate SKUs, limits, delivery choice, and stock.
- Verify order status transitions, stock deductions/restorations, and inventory history are transactionally consistent and reject insufficient stock. Review duplicate/retry behavior and concurrent orders.
- Review Storage upload authorization, content type/size checks, user/staff account management, secrets, error messages, and auditability.
- Run existing source regression tests, TypeScript/build checks, Firestore/Storage/Functions Emulator tests, and a manual role-based acceptance checklist.
- Fix the static export/deployment workflow only after confirming the current Next.js export configuration; do not deploy an empty `out` directory.

### Acceptance criteria
- Customer accounts cannot read private costs, staff pricing, staff records, or other customers' orders.
- Staff cannot perform admin-only operations; inactive users are rejected by trusted backend functions.
- Client-submitted prices/totals are never authoritative.
- Invalid quantities, duplicate SKU lines, overselling, invalid status changes, and unauthorized stock edits are rejected.
- Regression and Emulator tests pass, or every failure is documented and resolved before release.
- Production rules/functions are not changed until migration, test, backup, and rollback steps are reviewed.

## Phase 1 — Reliable customer and staff ordering (P1)

### Customer portal
- Customer account profile with company/shop details and saved delivery information.
- Customer-specific approved price lists and tier pricing, enforced server-side.
- Order history with status, printable order/pre-invoice documents, and reorder-to-cart.
- Search, category filtering, SKU/barcode search, clear stock availability, carton/pack/unit quantities, and minimum order rules.
- Clear checkout review of items, quantities, delivery/pickup method, customer details, and final server-confirmed total.
- Optional customer-specific saved lists/favourites after order and access rules are verified.

### Staff order desk
- Search/filter by status, customer, date, and order number.
- Consistent order status transitions with timestamps and responsible staff identity.
- Pick/pack list, shortage/substitution notes, and a final item/quantity check.
- Delivery note and proof-of-delivery record where appropriate.
- Duplicate-submit protection and understandable recovery when network requests are retried.

### Acceptance criteria
- A customer can place a valid order, review its server-calculated total, see its status, and reorder without staff manually rebuilding the cart.
- Staff can fulfil an order without changing protected price/stock fields from the browser.
- Order, status, and inventory history remain consistent after retries and failures.

## Phase 2 — Inventory and warehouse operations (P1)

- Stock receiving and supplier delivery records.
- Stock adjustments with required reason, actor, timestamp, and before/after quantities.
- Low-stock thresholds and an actionable low-stock list.
- Barcode/SKU scan workflow for receiving, picking, and stock counts.
- Damaged, expired, returned, and quarantined stock handling if relevant to the actual product range.
- Stock reservation policy: explicitly choose whether to reserve at checkout or at staff acceptance; show customers the policy and handle conflicts consistently.
- Stock count sessions and variance reports.

### Acceptance criteria
- Every stock change has a traceable source and actor.
- Parallel order acceptance cannot make stock negative.
- The available-stock number and order acceptance behavior follow one documented policy.

## Phase 3 — Customer accounts, payments, and credit control (P2)

- Customer account statements based on recorded orders, invoices, credits, and allocated payments.
- Partial payments and payment allocation, with a full immutable payment history.
- Configurable credit limits and overdue flags for customers explicitly approved for credit.
- Admin approval and audit trail for credit-limit exceptions, refunds, write-offs, and price overrides.
- Invoice numbering and document status rules appropriate to the business.
- Do not present an order pre-invoice as a tax invoice unless the business requirements and Malaysian accounting/tax requirements have been confirmed.

### Acceptance criteria
- Balances reconcile from recorded transactions rather than editable summary fields.
- Staff permissions separate order handling from financial adjustments.
- Reports can explain every balance change.

## Phase 4 — Purchasing and supplier management (P2)

- Supplier records and supplier-specific SKU/cost history.
- Purchase orders and receiving workflow.
- Partial receipts, damaged/short deliveries, and supplier returns.
- Reorder suggestions using stock on hand, committed stock, recent sales, and supplier lead time.
- Cost-change alerts and gross-margin impact preview before a new selling price is published.

### Acceptance criteria
- Received quantities update stock through a trusted, auditable operation.
- Purchase cost is restricted to authorized roles.
- Reorder recommendations are explainable and can be reviewed before a purchase order is sent.

## Phase 5 — Management reporting and communication (P2)

- Sales by day/week/month, product, category, customer, and staff member.
- Gross-margin reports only where reliable cost data and permissions exist.
- Fast/slow-moving products, stock ageing, stock-outs, order fulfilment time, and cancellations.
- CSV/Excel exports with role-based column restrictions.
- In-app order alerts first; add email or WhatsApp status notifications only with delivery-failure handling, consent/configuration, and retry protection.
- Operational dashboard showing pending orders, low stock, and overdue customer balances.

### Acceptance criteria
- Report totals reconcile with source orders, inventory, and recorded payment transactions.
- Exports never reveal fields the signed-in role cannot read in the application.

## Phase 6 — Usability and automation (P3)

- Installable mobile web/PWA experience after core workflows are stable.
- Saved order templates and one-tap repeat ordering.
- Suggested replenishment based on a customer's prior orders.
- Optional route/driver assignment and proof of delivery if delivery volume justifies it.
- Offline support only for safe read-only views or queued actions with conflict handling; do not allow offline stock/payment changes to silently overwrite server state.

## Cross-cutting engineering requirements

- Keep secrets server-side; never place privileged credentials in `NEXT_PUBLIC_*` variables.
- Validate all untrusted input at server boundaries; use least-privilege rules and explicit role/ownership checks.
- Make money/quantity calculations deterministic and validate numeric bounds.
- Use transactions or equivalent idempotent operations for stock/order/payment state changes.
- Keep an audit trail for privileged actions and financial/stock adjustments.
- Add automated tests for authorization, price tampering, duplicate submissions, duplicate SKU lines, concurrent stock changes, migration safety, and export privacy.
- Use separate development/test and production Firebase projects where possible.
- Add a documented backup, release checklist, rollback plan, and post-deployment smoke test.
- Prefer incremental changes and small pull requests. No broad redesign or production deployment without evidence that it is needed.

## Immediate next actions

1. Inspect the full diff and history of `security/wholesale-order-hardening` against `main`; confirm whether it has an associated pull request and whether it is already represented in `main`.
2. Run `cd functions && npm run test:security`.
3. Run the existing Emulator suite from `emulator-tests` with its documented Node/Java requirements.
4. Run the desktop production build and validate the static export output.
5. Fix all P0 failures before starting new business features.
6. Deliver Phase 1 in small, tested pull requests, starting with customer history/reorder and the staff fulfilment workflow only after confirming the existing screens' gaps.

## Current verification status

This roadmap is documentation, not a claim that implementation or tests have completed. The repository contents and available test scripts were inspected to prepare it. No application code was changed by this roadmap. Build, source regression tests, Emulator tests, Firebase deployment, and production verification have not been run as part of creating this document.
