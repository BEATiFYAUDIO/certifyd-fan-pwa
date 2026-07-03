# Certifyd Player MVP

## Product Boundary

The Certifyd Player is the Fan PWA.

- Contentbox owns canonical playback contract, offer/playback authorization, public creator/profile pages, buy/support pages, and APIs.
- Fan PWA owns discovery, playback UI, persistent player dock, continuous playback, and collection/support experience.
- No cross-repo static asset copying. Each repo deploys independently.

## Stage 1A Scope

Stage 1A adds the smallest player surface inside the existing Fan PWA app shell:

- A shared bottom player dock mounted once by the app.
- A desktop Now Playing panel that reuses the same player state for artwork, status, and support context.
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
- The Fan PWA does not infer entitlement, ownership, price, or unlock eligibility.
- The dock does not use legacy `fullMediaUrl`/`previewUrl` fields for stream selection.
- `mode: "none"` or missing `streamUrl` displays a graceful unavailable state and does not attempt playback.

Playback invariant:

- **Free:** `offer.playback.mode === "full"` and the UI shows `FREE` with a `Support Creator` CTA.
- **Paid locked:** `offer.playback.mode === "preview"` with the platform-authorized 20-second preview, `PREVIEW · 20 sec`, and the UI shows `Unlock / Support`.
- **Paid owned/unlocked:** `offer.playback.mode === "full"` and the UI shows `OWNED` with a `Support Creator` CTA.
- The Player is another client of the same Certifyd platform; public profile pages and the Fan PWA must use the same offer/playback contract.

## Current Layout Direction

The Fan PWA is the Certifyd Player MVP. Its information architecture is organized around continuous playback while fans move between scoped discovery, creator-network charts, browsing lanes, and personal context.

- **Scopes:** All, Entertainment, Music, News, Gaming, Sports, Technology, Trending, New, Live, and Following act as global filters for the selected center context.
- **Charts:** Network Pulse, Active Creator Ecosystems, Recently Published, Top Selling, Top Connected, and Fastest Moving are signal-driven rankings powered by existing discovery and signal data.
- **Explore:** Free Drops and Premium Works are browsing contexts for open/free works and premium/unlockable works.
- **Your World:** Following, Recently Played, and Saved are reserved personal contexts; unavailable personal data renders a clear empty state rather than fake content.
- The middle/main area renders the selected context instead of keeping every chart visible at once.
- The right-side Now Playing panel is desktop-only and mirrors shared player state; it does not own playback logic.
- The bottom dock remains the persistent playback control surface across Fan PWA navigation.
- Discovery cards, Free Drops, Premium Works, and WatchPage hand playback to the shared `playItem` path instead of rendering their own media elements.

## Out Of Scope

- Separate standalone player app.
- Contentbox mini-player dock/controller.
- Cross-repo static asset copying.
- Playlists, recommendations, comments, chat, offline playback, native apps, analytics, or node management.
