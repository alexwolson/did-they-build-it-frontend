# Did They Build It?

A crowdsourced, mobile-first web app for verifying — in person — whether Toronto
developers actually built the amenities their planning approvals required (bike
parking, public art, landscaping, street furniture, pavers). Volunteers open a
map, find the sites around them, see what a developer *agreed* to build, and tap
one button to report whether it's there.

Built for a Civic Tech Toronto field demo, on a foundation meant to grow into the
real thing — not a throwaway.

## How it works

- **Map** of every verifiable site (from the `aic-database` pipeline), clustered
  emoji pins over downtown Toronto, whose rings recolor as the community reports.
- **Near me** centers on your location and lists the closest sites by distance
  (falls back to map-center sorting if you decline location).
- **One-tap verify** — ✓ It's there / ✗ Not there / 🤷 Can't tell — *is* the
  submission. Optional photo and one-line note if you want to give more.
- **Live** — two phones checking the same site see each other's counts.
- **Offline-safe** — a flaky venue network never loses a report; verdicts queue
  in the browser and sync when the connection returns.

## Stack

SvelteKit (Svelte 5) on Cloudflare Workers · D1 (submissions) · R2 (photos) ·
MapLibre GL + OpenFreeMap tiles · a re-runnable ETL that bakes the upstream
SQLite database into static GeoJSON.

## Develop

```bash
npm install
npm run dev              # vite dev with local D1/R2 emulation (Miniflare)
```

First run needs the local database schema:

```bash
npx wrangler d1 migrations apply did-they-build-it-db --local
```

Everything runs locally with no Cloudflare account — bindings are emulated.

### Refreshing the site data

The map data (`static/data/sites.json`) is generated from the upstream
`../aic-database/data/frontend.db` snapshot. To rebuild after the pipeline
produces new data:

```bash
npm run etl              # reads ../aic-database/data/frontend.db → static/data/sites.json
```

Applications lacking coordinates are reported loudly and can be placed manually
in `etl/overrides.json`.

## Test

```bash
npm test                 # unit tests (ETL transforms, validation, geo, queue, status)
npm run test:workers     # server logic against a real local D1 (workers pool)
npm run check:size       # deterministic 400 KB gzip client-JS budget
```

## Deploy

`main` is protected: changes land via PR, gated on three required checks —
`tests`, `bundle-size`, and `lighthouse`. Merging to `main` auto-deploys to
Cloudflare Workers (`.github/workflows/deploy.yml`): it applies D1 migrations
remotely, then `wrangler deploy`. Requires the repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

A printable QR code for the venue lives at `/qr` — it encodes whatever origin
it's served from, so in production it points at the deployed URL automatically.

## Design docs

- Spec: [`docs/superpowers/specs/2026-07-20-ctto-prototype-design.md`](docs/superpowers/specs/2026-07-20-ctto-prototype-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-07-20-ctto-prototype.md`](docs/superpowers/plans/2026-07-20-ctto-prototype.md)
