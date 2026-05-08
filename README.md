# Certifyd Fan PWA

Certifyd Fan is a lightweight discovery and routing app for Certifyd Creator nodes.

It is **not** a commerce or creator-management app.
It only reads public discoverable content and routes fans to creator buy pages.

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

Multiple origins are comma-separated.

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
