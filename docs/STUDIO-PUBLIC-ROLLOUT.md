# VibeFlex Studio: website customization and business distribution

## Implemented in this change

`public/studio-launcher.js` adds an accessible, style-isolated button to any website. It opens the existing `/studio` in a new tab, preserving uploads and checkout on the Studio origin. The script accepts only a text label; it never accepts a store, token, checkout destination, or tenant identifier. It does not turn an embedding website into a merchant account.

Once this version is deployed to the existing production host:

```html
<script defer src="https://vibe-flex-studio.vercel.app/studio-launcher.js" data-label="Create your custom gear"></script>
```

The existing Studio checkout uses the configured VibeFlex Shopify store. Launching it from another business's website still purchases from VibeFlex. This must be stated accurately in sales and onboarding material.

## Required before taking customer orders

Verify persistent artwork storage and database writes, live supplier catalog/variant mappings, the exact selected size/color and Shopify price, checkout availability, and a paid order's artwork/geometry arriving in the production workflow. Confirm supplier billing and fulfillment funding. Existing code paths are not evidence these services are live.

## Required for independent merchant installs

The current environment-based Shopify and supplier credentials are single-store. Do not expose a shop selector or use a browser-supplied shop value to choose credentials.

1. Register a public-distribution Shopify app for unrelated merchants. Keep development installations separate. Shopify review is an external release requirement.
2. Add verified Shopify installation/authentication with encrypted, revocable sessions per shop. Validate authenticated shop context on every merchant operation.
3. Migrate designs, assets, catalog mappings, provider accounts, jobs, idempotency keys and audit logs to tenant-scoped records. Enforce tenant boundaries in every query and storage operation. Migrate existing VibeFlex records explicitly.
4. Create a theme app extension to place the customizer on participating storefronts. Bind customer requests to server-verified shop context, with bounded uploads and rate limits. A launcher query parameter is not authentication.
5. Validate the purchasable Shopify variant against the configured product, color, size and approved price. Persist an immutable production specification before checkout. Prevent client-authored fulfillment metadata from controlling production.
6. Verify raw-body webhook signatures, shop installation status and paid-order eligibility. Queue fulfillment idempotently with retry and duplicate-order tests. Support cancellation/refund handling and merchant-visible failures.
7. Add merchant onboarding, Shopify-compatible app billing, uninstall cleanup, data export/deletion and required privacy webhooks. Avoid introducing Stripe, PayPal or Square.
8. Verify two separate development shops cannot read or mutate each other's designs, credentials, orders or provider accounts; then test installation through delivery on each.

## Release evidence

This change provides a website entry point only. Public merchant installation, billing, tenant isolation and automated fulfillment have not been implemented by this change. Do not market it as an installable multi-business app yet.

Official references:
- https://shopify.dev/docs/apps/launch/distribution
- https://shopify.dev/docs/apps/build/online-store/theme-app-extensions
- https://shopify.dev/docs/apps/build/online-store/app-proxies
