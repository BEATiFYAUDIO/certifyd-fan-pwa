# Certified Fan Discovery Ranking

Certified Fan ranking is presentation-only. It does not decide entitlement, payment, payout, settlement, receipt validity, content access, or commerce authority. It only sorts already-discoverable public items returned to the Fan PWA.

## Work-Level Scores

### `publicSupportScore(item)`

Looks for the first positive numeric field among:

```ts
supportCount
supportedCount
supporterCount
supportersCount
purchaseCount
purchasesCount
saleCount
salesCount
unlockCount
unlocksCount
tipCount
tipsCount
popularityScore
supportScore
```

Used for:

- `Most Supported`
- creator ranking boost
- creator badge: `Supported X`

### `publicUnlockScore(item)`

Looks for the first positive numeric field among:

```ts
unlockCount
unlocksCount
purchaseCount
purchasesCount
saleCount
salesCount
```

Used for:

- `Most Unlocked`

### `publicConversionScore(item)`

Looks for the first positive numeric field among:

```ts
conversionRate
conversionScore
purchaseRate
unlockRate
supportRate
```

Used for:

- `Best Converting`

### `publicRelationshipScore(item)`

Looks for the first positive numeric field among:

```ts
collaboratorCount
collaboratorsCount
contributorCount
contributorsCount
creditCount
creditsCount
splitParticipantCount
participantCount
relatedWorkCount
relationshipCount
```

Used for:

- creator ranking boost
- creator badge: `X connections`

## Posture / Source Score

`publicPostureScore(item)` adds small bonuses from public-safe source/origin fields:

```ts
originHealth healthy/online/reachable: +8
originTrust stable/trusted: +6
originTrust provider: +5
commerce capable/buyUrl/offerUrl: +4
posture includes provider/verified: +3
posture includes creator/commerce: +2
```

Used for:

- creator ranking boost
- creator badge: `Trusted source`

This is intentionally smaller than work count and public support. Posture can help ranking, but it should not dominate ranking.

## Creator Ranking

Creators are grouped by:

```ts
publicOrigin + creatorHandle
```

Each creator gets a weighted score:

```ts
rows.length * 10_000_000_000_000
+ support * 100_000_000
+ relationships * 1_000_000
+ posture * 100_000
+ premiumWorks * 50_000
+ topicTypeBreadth * 10_000
+ latestTimestamp
```

Meaning:

- work count dominates
- public support/sales/unlocks strongly influence ranking
- relationship/collaboration signals matter
- posture/source trust helps lightly
- premium/free mix and topic/type breadth add texture
- recency breaks ties

## Hub Creator

The top-ranked creator becomes the large `Hub creator` card.

A creator feels like a hub when they have:

- many works
- support/sales/unlock signals
- relationship/collaboration counters
- trusted/reachable source
- unlockable works
- varied topics/types
- recent activity

## Top Board Surfaces

### Most Supported

Shown only if at least one item has `publicSupportScore > 0`.

Sorted by support score descending.

### Most Unlocked

Shown only if at least one item has `publicUnlockScore > 0`.

Sorted by unlock score descending.

### Best Converting

Shown only if conversion fields exist.

Sorted by conversion score descending.

### Creator Momentum / Fastest Moving

Fallback when strong metrics are sparse.

Uses deduped works from:

- creator spotlights
- recent works
- filtered items

### Recent Publications

Fallback if fewer ranked metric surfaces exist.

Uses timestamp fields when present:

```ts
publishedAt
createdAt
updatedAt
```

## Fallback Behavior

The Fan PWA can only rank by fields present in `/public/discoverable-content`.

If ContentBox does not expose sales/support/unlock/collaboration aggregates, the app falls back to:

- work count
- recency
- creator activity
- public origin/source health
- free/premium mix
- topics/types

The UI is ready for real metrics, but it does not fake them.

## Guardrails

Discovery ranking must not expose or depend on:

- payout rows
- royalties
- settlement state
- participant percentages
- buyer identities
- private revenue
- treasury/operator metrics
- entitlement state beyond public-safe access labels

Discovery ranking is descriptive and presentational. Existing ContentBox systems remain final authority for commerce, entitlement, access, receipts, settlement, payouts, splits, and proof.
