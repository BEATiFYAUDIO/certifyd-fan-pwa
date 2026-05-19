# Fan Relationship Discovery: Phase 1 Read-Side Context

Certified Fan should become a relationship-native discovery surface, not just a better feed. Phase 0 shelves can organize the current `/public/discoverable-content` payload, but they cannot truthfully expose creative lineage, collaborators, attribution, split participation, or connected creator paths.

This document defines the smallest safe read-side addition needed to make Fan discovery feel relational while preserving existing Certifyd authority systems.

## Phase 0: What It Can Do

Phase 0 uses only the current discoverable payload already available to the Fan PWA.

It can safely show:

- Free Drops
- Premium Works
- Recently Published or Recently Indexed
- Creator Spotlights
- Topic or content-type shelves when enough items exist
- More From This Creator, based on currently loaded items
- More Like This, based on topic/type only
- From This Source, based on public origin only

Phase 0 is useful for layout and browsing, but it is shallow. It cannot claim real collaboration, lineage, derivation, or participation unless that data is already present in the payload.

## Phase 0: What It Cannot Truthfully Do

Phase 0 must not fake labels such as:

- Inspired by
- Built from
- Featuring
- Revenue shared with
- Derivative of
- Connected creators
- People behind this
- Collaboration chains
- Lineage paths
- Provenance paths

Those require actual ContentBox relationship data, not topic/type inference.

## Proposed Endpoint

```http
GET /public/content/:id/context
```

Purpose: return public-safe relationship context for one published work.

Properties:

- Read-only
- Cacheable
- Public-safe
- Additive
- Non-authoritative
- Safe to fail without breaking the Fan PWA
- Does not decide payment, entitlement, payout, settlement, split authority, derivative approval, proof validity, receipt validity, or purchase eligibility

Existing public buy, entitlement, receipt, proof, split locking, payout, derivative approval, and commerce routes remain final authority.

## Backend Sources

The endpoint should derive descriptive context from existing ContentBox systems only:

- `ContentItem`
- `ContentCredit`
- `SplitVersion`
- `SplitParticipant`
- `ContentLink`
- Manifest/proof state
- Public creator profile data
- Public origin info
- Public-safe purchase/support aggregates only if already approved as public-safe

No new authority model should be introduced.

## Suggested Response Shape

```ts
type PublicContentContext = {
  contentId: string;
  publicOrigin: string;
  title: string;
  contentType: string;
  primaryTopic?: string | null;
  creator: PublicCreatorSummary;
  peopleBehindThis: PublicParticipant[];
  featuring: PublicParticipant[];
  createdWith: PublicParticipant[];
  builtFrom: RelatedWork[];
  derivedFrom: RelatedWork[];
  worksThatBuiltOnThis: RelatedWork[];
  moreTheyWorkedOn: RelatedWork[];
  relatedWorks: RelatedWork[];
  connectedCreators: PublicCreatorSummary[];
  provenance?: PublicProvenanceSummary;
  origin?: PublicOriginSummary;
  generatedAt: string;
};

type PublicCreatorSummary = {
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  publicOrigin?: string | null;
};

type PublicParticipant = {
  displayName?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
  relationshipLabel: string;
  profileUrl?: string | null;
  publicOrigin?: string | null;
};

type RelatedWork = {
  contentId: string;
  title: string;
  contentType: string;
  primaryTopic?: string | null;
  coverUrl?: string | null;
  previewUrl?: string | null;
  publicUrl?: string | null;
  creator?: PublicCreatorSummary;
  relationshipLabel: string;
};

type PublicProvenanceSummary = {
  hasManifest: boolean;
  hasLockedProof: boolean;
  proofVersion?: number | null;
  lockedAt?: string | null;
};

type PublicOriginSummary = {
  origin: string;
  displayHost: string;
  health?: 'healthy' | 'failed' | 'cooldown' | 'unknown';
  trust?: 'stable' | 'ephemeral' | 'provider' | null;
};
```

## Fan-Facing Sections

These are user-facing labels for Fan UI. They should feel human and content-type agnostic.

### People Behind This

Shows the primary creator and public-safe contributors/participants attached to the work.

Sources:

- `ContentCredit`
- accepted/public-safe `SplitParticipant`
- public creator profile data

### Featuring

Shows public contributors whose role indicates visible participation, performance, appearance, guest contribution, or similar creator-facing contribution.

Sources:

- `ContentCredit.role`
- public-safe participant metadata

Avoid showing private pending invite data.

### Created With

Shows collaborators and contributors associated with the work, without implying financial settlement unless explicitly public-safe.

Sources:

- `ContentCredit`
- accepted/public-safe `SplitParticipant`

### Built From

Shows upstream works or parent works when the relationship exists.

Sources:

- `ContentLink`
- derivative/parent-child relationship data

### Derived From

Shows source work lineage where this work is a derivative.

Sources:

- `ContentLink`
- approved/public derivative relationships
- public-safe upstream work metadata

### Works That Built On This

Shows downstream works that derive from or reference this work.

Sources:

- `ContentLink`
- public-safe child/downstream content rows

### More They Worked On

Shows other public works involving the same creator/contributors.

Sources:

- `ContentCredit`
- `SplitParticipant`
- public profile content visibility rules

### Related Works

Shows works connected by shared creator, collaborator, lineage, or explicit content links.

Sources:

- `ContentLink`
- shared public collaborators
- shared public creator participation

### Connected Creators

Shows creators connected through shared works, credits, splits, or lineage.

Sources:

- public creator profile data
- public-safe credit/split participation
- public-safe relationship counts

## Later-Phase Labels

These should wait until public-safe aggregate rules are explicit.

### Revenue Shared With

Do not expose unless the platform has a clear public rule for showing economic participation. Split percentages may be sensitive depending on publication context.

If later enabled, it must be descriptive only and must not act as settlement authority.

### Trending Collaboration Chains

Do not build until there are real public-safe engagement or relationship signals. No fake trending.

## Public-Safe Exposure Rules

The context endpoint must only expose data that is already public-safe.

Allowed:

- Published content metadata already public on buy/profile/discovery surfaces
- Public creator handle/display name/avatar/profile URL
- Public credits and roles already visible on public pages
- Accepted/public-safe collaborators if they are already part of the published attribution surface
- Public derivative relationships where both works are public-safe
- Proof/manifest summary flags, not sensitive raw internals
- Origin health/trust summary already used for discovery safety

Avoid or redact:

- Private emails unless already intentionally public
- Pending invite tokens
- Invite internals
- Unaccepted participant rows
- Internal user IDs
- Local database IDs as identity claims
- Payment intent IDs
- Receipt secrets
- Entitlement records
- Payout destination details
- Settlement execution details
- Non-public split drafts
- Unpublished, archived, trashed, tombstoned, or unhealthy-origin content unless a direct-link unavailable state explicitly allows limited metadata

## Non-Goals

Do not use this endpoint to decide:

- Payment success
- Entitlement ownership
- Purchase eligibility
- Receipt validity
- Payout settlement
- Split authority
- Split locking
- Derivative legal validity
- Proof generation validity
- Public buy behavior
- Commerce posture

Do not build:

- Universal capability engine
- Graph database rewrite
- AI recommendation system
- Fake trending
- Per-card uncached backend fan fetch storm
- Authority replacement for existing ContentBox systems

## Cache And Failure Behavior

Recommended behavior:

- Cache per `contentId` and public origin.
- Use short-to-medium TTL initially.
- Allow stale context if the core discoverable item is still live and safe.
- If context fails, Fan should still render the normal content page/card.
- Context must never block buy/open/unlock CTAs.
- Context must never override `discoveryStatus`, `originHealth`, entitlement, pricing, or buy URLs.

## Safest Implementation Sequence

1. Define `GET /public/content/:id/context` behind a small additive read-only handler in ContentBox.
2. Return only `peopleBehindThis`, `creator`, `origin`, and a minimal `provenance` summary first.
3. Add Fan detail-page rendering for `People Behind This` only.
4. Add `More They Worked On` using already public profile/discovery-visible content.
5. Add `Built From` / `Derived From` only after confirming `ContentLink` public-safety rules.
6. Add `Works That Built On This` only for public, live, non-archived downstream works.
7. Add `Connected Creators` once collaborator identity normalization is reliable and privacy-safe.
8. Consider public-safe support/purchase aggregates only after explicit product/privacy rules exist.

## First Small UX Moment

On a content detail page, add a simple relationship card:

> People Behind This
>
> Created by Darryl Hillock. Featuring Beatify Group. More works involving these creators.

This is the smallest visible step toward relationship-native discovery. It uses real public attribution and does not alter any commerce or authority behavior.
