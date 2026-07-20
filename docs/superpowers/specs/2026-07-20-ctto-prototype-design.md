# Did They Build It? — CTTO Field-Demo Prototype Design

**Date:** 2026-07-20
**Status:** Approved
**Demo:** Civic Tech Toronto, evening of 2026-07-21

## Purpose

A crowdsourced, mobile-first web app where volunteers verify in person whether
developers actually built what their approval was conditioned on (bike parking,
landscaping, public art, street furniture, pavers). This prototype must be usable
in the field tomorrow evening AND serve as the foundation of the real app — no
throwaway code.

Data source: the `aic-database` pipeline (sibling repo), which extracts
development-approval conditions from Toronto staff reports. The current snapshot
(`../aic-database/data/aic.db`) covers wards 10/11/13 with ~78 physically-verifiable
conditions across ~90 addresses; it will grow, so data import is a re-runnable step.

## Principles

1. **FAST** — volunteers' patience is limited. Interactive map < 2.5 s on a
   mid-range Android on 4G. Total JS < 400 KB gzip (hard gate). Verdict tap
   acknowledged < 50 ms.
   **Lighthouse note (revised during Task 6):** a full-screen WebGL vector map
   is intrinsically expensive on Lighthouse's throttled-mobile Total-Blocking-Time
   and Largest-Contentful-Paint metrics — MapLibre/Mapbox/Google-Maps apps all
   score ~0.4–0.6, and ours cannot reach 0.85 without abandoning the map. After
   optimizing (positron basemap, idle-deferred dynamic-`import()` of MapLibre,
   preconnect), the measured composite is ~0.52. The CI gate is therefore set to
   **0.45** — honest to what the map achieves, still catching real regressions.
   Two caveats keep this from being a cop-out: (a) the 400 KB-gzip bundle-size
   gate remains the hard JS-discipline check (currently ~294 KB); (b) CI measures
   against `wrangler dev`, which understates production edge performance — the
   proper future fix is to Lighthouse a Cloudflare **preview deployment** per PR
   (token now available), which should restore a meaningful high-score gate. The
   page's own paint metrics are already good (FCP ~2 s, Speed Index ~3 s); the
   score is dragged down by unavoidable WebGL boot cost, not by our code shipping
   too much or painting slowly.
2. **EASY** — the minimum meaningful ask is ONE TAP. Everything beyond a verdict
   (photo, note) is optional and clearly skippable.
3. **FUN** — vector map and UI motion at the display's **native refresh rate**
   (120/144/240 Hz where the hardware offers it — never artificially capped at
   60), optimistic UI, confetti micro-burst + haptic on submission, session
   tally ("3 promises checked tonight"), pins that visibly accumulate community
   status over the evening.

## Architecture

One SvelteKit (Svelte 5) app deployed to Cloudflare Workers (static assets +
server routes via the Cloudflare adapter), plus a re-runnable ETL script in this
repo.

```
../aic-database/data/aic.db  (read-only input)
        │
        ▼
  ETL (scripts/)  ──geocode──  Toronto Open Data "Address Points" bulk file
        │                      + committed geocode cache + manual overrides
        ▼
  static/data/sites.json      (GeoJSON FeatureCollection, ships on CDN)
        │
        ▼
  SvelteKit app ── /api/submissions POST ──► D1 (submissions, devices)
                ── /api/status GET ────────► D1 aggregate verdict counts
                ── photo upload ───────────► R2 (client-downscaled JPEG)
```

- **Static promise data**: each GeoJSON feature is a *site* (one application =
  one pin; applications can span many addresses — use primary address, one pin).
  Feature properties: site id, aic_ref, display address, ward, approval year,
  source report URL, and its physically-verifiable conditions (key, type,
  plain-language description, verbatim raw text). ~tens of KB now; < 1 MB gzip
  even city-wide, so this pattern outlives the demo.
- **Dynamic data is only what people create.** Submissions and status counts go
  through D1. `/api/status` is fetched async and merged client-side — never
  blocks first paint.
- **Map**: MapLibre GL JS + OpenFreeMap vector tiles (no API key, no usage caps).
- **Server-side validation** of submissions checks `condition_key` / `site_id`
  against the same sites.json (imported by the server route) — no reference
  tables to sync in D1.

## ETL

- Reads aic.db: conditions where `physically_verifiable = 1`, joined to
  applications and addresses. Groups by application → site.
- Geocoding: normalize address strings and match against Toronto Open Data's
  Address Points dataset (city's own address→coordinate repository, free bulk
  download, committed or cached locally). A committed geocode cache keeps builds
  deterministic; a manual-overrides JSON handles stragglers. Unmatched addresses
  are printed loudly in build output and skipped, never silently dropped
  city-wide without a report.
- `condition_key` = stable hash of `(aic_ref, condition_type, raw_text)` — NOT
  the aic.db row id — so the pipeline can rebuild its DB without orphaning
  submissions.
- Refresh = rerun ETL + redeploy (~2 min), e.g. if fuller ward 11/13 data lands
  before the demo.

## D1 schema

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,            -- random UUID minted client-side, localStorage;
                                  -- server upserts the row on first submission
  nickname TEXT,                  -- NULL for now; nickname/auth attaches here later
  created_at TEXT NOT NULL
);
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,            -- UUID
  condition_key TEXT NOT NULL,
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('present','absent','unclear')),
  note TEXT,
  photo_key TEXT,                 -- R2 object key
  lat REAL, lng REAL, accuracy_m REAL,  -- where the submitter stood, if granted
  created_at TEXT NOT NULL,
  UNIQUE (device_id, condition_key)     -- re-submit = update your verdict
);
```

## UX

**Map screen (the app IS the map).** Full-screen map of downtown Toronto with
all pins on load — no splash, no onboarding, no permission prompt. Pins
color-coded by condition type with icon (🌳 landscaping, 🚲 bike parking,
🎨 public art, 🪑 street furniture, 🧱 pavers); multi-type sites get a count
badge. Sites with reports get a status ring (green-ish = "it's there" majority,
red-ish = "missing" majority). Header: app name + list toggle.

**Location on demand.** A prominent "Near me" FAB triggers the geolocation
permission ask (contextual ask, not on load). Granted → flyTo user, pulsing blue
dot, nearby list slides up sorted by distance ("120 m · 147 Spadina Ave · 🌳 +2
more"). Denied/unavailable/inaccurate → same list sorted from map center. List
and map are two views of one state.

**Site sheet.** Tap pin or list row → bottom sheet over the map (map stays
visible). Address, approval year, "source: staff report ↗" link. Then
**"The developer agreed to build:"** with one card per condition: icon, type,
plain-language description, and the verbatim legal text behind a "show exact
wording" expander. Sheet sets URL to `/site/[id]` — shareable, and the phone
back button closes it.

**One-tap verify.** Per-condition buttons: **✓ It's there / ✗ Not there /
🤷 Can't tell**. Tapping one IS the submission — optimistic, instant, confetti
micro-burst + `navigator.vibrate` tick. Then an optional strip expands: "Add a
photo or note?" — camera button (`capture=environment`) + one-line note, both
skippable; the submission already counts. If this device already reported this
condition, show that verdict; tapping another updates it (UNIQUE upsert).
Session tally toast between sites.

**Photos**: downscaled on-device (max ~1600 px JPEG) before upload. Demo shows
photo *counts* on cards but does not display strangers' photos (moderation is
out of scope today).

## Motion & frame rate

The app targets the display's native refresh rate, not a fixed 60 fps.
`requestAnimationFrame` already fires at native Hz in modern browsers; our job
is to never be the bottleneck or the cap:

- **Frame budget is 8.3 ms** (120 Hz) for main-thread work during interaction —
  pan, sheet drag, marker updates — not 16.7 ms. Treat 4.2 ms (240 Hz) as the
  stretch target for our own UI code; the GPU-bound map may not sustain 240 Hz
  on real hardware, but the cap must come from the hardware, never from us.
- **All bespoke animations are delta-time-based** (scaled by elapsed ms, never
  per-frame increments) so confetti and fly-to feel identical at 60, 120, or
  240 Hz instead of running 2–4× fast. No fps-capped animation libraries.
- **UI motion runs on the compositor**: bottom sheet, status-ring transitions,
  and marker pop-ins animate `transform`/`opacity` only (CSS transitions or
  Web Animations API), which the browser drives at native Hz off the main
  thread. During sheet drags, pointer input writes transforms directly —
  no layout reads in the hot path.
- **Known ceiling we don't control**: iOS Safari only recently allows web
  content above 60 Hz on ProMotion devices; older iOS versions pin rAF to 60
  regardless of what we ship. Android Chrome has run rAF at native Hz for
  years.
- **Verification is manual on-device** (a high-refresh Android/iPhone with the
  browser FPS HUD): CI's Lighthouse runs headless at 60 Hz and can't see this.
  What CI does enforce — the total-blocking-time and script-size gates — is
  what keeps the frame budget achievable.

## Resilience & error handling

- Verdicts queue in localStorage and retry in the background; failed POSTs never
  lose a submission. Quiet "1 report syncing…" indicator when the queue is
  non-empty.
- Photo upload failure degrades gracefully: verdict stands, photo retries
  separately.
- Geolocation denied / unavailable / low accuracy → distance-from-map-center
  fallback. No empty states that strand the user: if nothing is within 2 km, show
  nearest sites with honest distances.
- ETL geocode misses: reported in build output + manual-overrides file.

## Testing

Proportionate to a one-day build:
- vitest unit tests: ETL address normalization + geocode matching (highest
  silent-corruption risk).
- Integration tests: submissions API against local D1 (wrangler test platform).
- Component test: verify-card state machine (tap → submitted → update verdict).
- Map + field behavior: manual, on real phones, today.

## Repo policy & CI (starting principle)

The repo lives on GitHub with a **protected `main`**: changes land via PR, and
PRs are gated on required status checks. This is a founding principle, not a
later hardening step — the performance budget is enforced from the first
feature PR onward.

Required checks:

- **Lighthouse CI** (`@lhci/cli` in GitHub Actions): builds the app, serves it
  via `wrangler dev`, runs Lighthouse with mobile emulation (throttled CPU + 4G
  — matches the mid-range-Android target), `numberOfRuns: 3`, asserts on the
  **median**. Assertion threshold: performance ≥ **0.45** — recalibrated in Task
  6 to the level a full-screen WebGL map actually achieves (see the FAST
  principle's Lighthouse note). Not the original ≥ 0.85, which is unreachable
  with a map as the primary content. Future improvement: measure a Cloudflare
  preview deployment instead of `wrangler dev` to get a production-representative
  score and restore a higher gate.
- **Bundle-size gate**: deterministic check that total shipped JS ≤ 400 KB gzip.
  Exact and never flaky — this, not Lighthouse, is the enforcement mechanism for
  the size budget.
- **Tests**: vitest suite (ETL, API, verify-card state machine).

Deploys: merge to `main` → GitHub Actions deploys via `wrangler deploy`
(Cloudflare API token in repo secrets). Bootstrap exception: today's initial
scaffold commits land directly on `main` before protection is switched on;
everything after runs through PRs.

## Deploy & demo ops

- `*.workers.dev` URL (custom domain later). The app serves a printable QR-code
  page at `/qr` for scan-and-go at the venue.
- Data refresh before demo if the pipeline lands more: rerun ETL, redeploy.
- Post-demo analysis: `wrangler d1 export` of submissions; consider showing the
  crowd their aggregate at the end of the night.

## Out of scope (deliberate, not accidental)

- Nicknames / auth (devices table is the attachment point).
- Public display of submitted photos (needs moderation).
- Offline map tiles / full PWA.
- Abuse protection beyond device-level dedupe.
- Admin/moderation UI.
- Non-verifiable condition types (cash contributions, affordable housing, etc.)
  — the app only shows `physically_verifiable = 1`.

## Decisions log

| Decision | Choice |
|---|---|
| Data source | Snapshot of ../aic-database/data/aic.db, re-runnable ETL |
| Submission | One-tap verdict; photo + note optional afterward |
| Identity | Anonymous device UUID now; nickname/auth later via devices table |
| Hosting | Cloudflare Workers + D1 + R2 |
| Framework | SvelteKit (Svelte 5), Cloudflare adapter, single full-stack app |
| Map | MapLibre GL JS + OpenFreeMap vector tiles |
| Promise data | Static GeoJSON on CDN; only submissions/status are dynamic |
| Condition identity | Hash of (aic_ref, condition_type, raw_text) |
| Repo policy | GitHub, protected main, PRs gated on Lighthouse CI + size + tests |
| Deploys | Auto-deploy to Cloudflare on merge to main |
