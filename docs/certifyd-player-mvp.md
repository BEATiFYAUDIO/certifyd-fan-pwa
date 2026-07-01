# Certifyd Player MVP

## Product Boundary

The Certifyd Player is the Fan PWA.

- Contentbox owns canonical playback contract, offer/playback authorization, public creator/profile pages, buy/support pages, and APIs.
- Fan PWA owns discovery, playback UI, persistent player dock, continuous playback, and collection/support experience.
- No cross-repo static asset copying. Each repo deploys independently.

## Stage 1A Scope

Stage 1A adds the smallest player surface inside the existing Fan PWA app shell:

- A shared bottom player dock mounted once by the app.
- Discovery-card `Play in Certifyd` handoff into the dock.
- One playback path for preview and full streams.
- Support/Buy CTA that links to the existing platform buy/support page.
- Playback state that remains alive while the Fan PWA shell remains loaded.

## Canonical Playback Contract

The Fan PWA fetches the canonical offer and plays only `offer.playback`:

```ts
playback: {
  mode: "full" | "preview" | "none";
  streamUrl: string | null;
  previewLimitSeconds: number | null;
  canPlayFull: boolean;
  reason?: string;
}
```

Rules:

- The platform decides full, preview, or no playback.
- The Fan PWA does not infer entitlement, ownership, price, preview duration, or unlock eligibility.
- The dock does not use legacy `fullMediaUrl`/`previewUrl` fields for stream selection.
- `mode: "none"` or missing `streamUrl` displays a graceful unavailable state and does not attempt playback.

## Out Of Scope

- Separate standalone player app.
- Contentbox mini-player dock/controller.
- Cross-repo static asset copying.
- Playlists, recommendations, comments, chat, offline playback, native apps, analytics, or node management.
