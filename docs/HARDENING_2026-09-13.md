# Production hardening evidence

Related: #5. Audited main commit 8aac5fc2e54b467732059dcebb8b0a99603b69f6.

## Verified locally before environment loss
- npm ci --ignore-scripts installed 211 packages.
- Baseline: 51 tests passed, TypeScript passed, next build exited successfully.
- With this hardening increment: 57 tests passed, TypeScript passed, compilation and static page generation succeeded. The final build exit and HTTP probes were not recovered before the environment disconnected.
- Attempted production start. Explicit localhost binding bypassed the runtime's network-interface enumeration restriction and reached Starting; readiness was not confirmed.
- Admin gate now returns 503 when unconfigured and 401 for invalid credentials. Six regression cases cover blank/missing configuration, malformed/incorrect credentials, and valid credentials.
- Existing-draft lookup errors now stop creation rather than allowing duplicates after a failed lookup.
- PENDING visual QA no longer reports pipelineOk=true. Draft-only product mutation remains unchanged.
- Activated the existing documented CI in the actual .github/workflows path, with read-only contents permission and no secrets.

## Remaining production gates
- Configure admin credentials and verify deployed HTTP behavior. Public upload/design routes and paid-provider abuse protections still need review.
- Verify durable artwork storage, public mockups and actual provider catalog/variant mapping in an isolated test environment.
- Durable duplicate-product protection remains incomplete: reference lookup is not an atomic cross-process lock, and requests without a reference bypass lookup.
- The order webhook verifies raw-body HMAC, but order-line persistence failures are ignored and there is no unique order/line constraint. Replay-safe storage and retry semantics still require a reviewed migration/test plan. No migrations were run.
- Fulfillment planning does not fully validate provider variant IDs/geometry/address. No provider order submission was performed or enabled.
- Live Shopify draft/read-back, database persistence and order replay remain unverified. Any approved controlled test must keep products DRAFT and fulfillment disabled.

Do not merge or deploy on the strength of this report alone. Re-run CI and runtime checks after execution access is restored.
