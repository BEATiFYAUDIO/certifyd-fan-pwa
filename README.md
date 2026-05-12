# Certifyd Discovery PWA

Certifyd Discovery is a lightweight discovery and routing app for Certifyd Creator nodes.

It is **not** a commerce or creator-management app.
It only reads public discoverable content and routes discovery traffic to creator buy pages.

## Stack

- React
- Vite
- TypeScript
- Tailwind CSS
- react-router-dom
- vite-plugin-pwa

## API usage

Used:
- `GET {origin}/public/discoverable-content`

Not used:
- payment POST routes
- buyer claim routes
- receipt/access write routes
- provider/payout/split/creator dashboard routes

## Environment

Create `.env` from `.env.example`:

```env
VITE_CERTIFYD_ORIGINS=https://certifyd.beatifygroup.com
```

Multiple env origins are comma-separated.

## Static network registry

The app can also load creator origins from a static file:

- `public/origins.json`

Example:

```json
{
  "origins": [
    "https://certifyd.beatifygroup.com",
    "https://certifyd.darrylhillock.com"
  ]
}
```

Behavior:

- Origins are loaded from both:
  1. `public/origins.json`
  2. `VITE_CERTIFYD_ORIGINS`
- Both sources are merged and deduped.
- Invalid/empty origins are ignored.
- Allowed origins:
  - `https://...`
  - `http://localhost...`
  - `http://127.0.0.1...`
- If `origins.json` is missing or malformed, app continues gracefully.

To add a creator node, append its HTTPS origin to `public/origins.json` (and/or env).

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`

## Features (MVP)

- Home feed with topic chips:
  - All, Entertainment, Music, News, Gaming, Sports, Technology
- Search bar filtering title/creator/topic/type
- Responsive card grid
- Watch route (`/watch/:contentId`) with preview-first player
- CTA behavior:
  - `locked` => Unlock on Creator
  - `unlocked` => Open on Creator
  - `owned` => Open on Creator
- Empty/loading/error states
- Basic per-origin cursor pagination

## PWA/build

```bash
npm run build
npm run preview
```

The output in `dist/` is deployable to GitHub Pages or any static host.
