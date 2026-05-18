# Certified Fan Discovery Phase 1 TODO

Phase 0 uses only the current `/public/discoverable-content` payload inside the Fan PWA.

Real relationship discovery should come from additive, read-only ContentBox context endpoints:

- `GET /public/content/:id/context`
- `GET /public/creators/:handle/context`
- `GET /public/discovery/context`

These endpoints should describe public-safe relationships only, such as contributors, related works, creator context, and explicit derivative relationships.

They must never become authority for commerce, entitlements, payouts, settlements, split locking, derivative approval, proof generation, receipts, or public buy behavior.
