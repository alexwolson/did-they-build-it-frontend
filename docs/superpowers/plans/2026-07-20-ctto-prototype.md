# Did They Build It? — CTTO Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile-first crowdsourced verification app (map → nearby sites → one-tap "did they build it?" verdicts with optional photo/note) to a public Cloudflare Workers URL today, for tomorrow evening's Civic Tech Toronto field demo.

**Architecture:** One SvelteKit (Svelte 5) app on Cloudflare Workers. A re-runnable ETL reads `../aic-database/data/aic.db`, converts the city's MTM zone 10 X/Y coordinates to WGS84, and bakes `static/data/sites.json` (GeoJSON) that ships on the CDN. Submissions go to D1 via SvelteKit server routes; photos to R2. GitHub `main` is protected; PRs gate on tests + Lighthouse + a deterministic bundle-size check; merges auto-deploy.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes) · @sveltejs/adapter-cloudflare 7 · wrangler 4 · D1 + R2 · MapLibre GL JS 5 + OpenFreeMap vector tiles · proj4 · vitest 4 + @cloudflare/vitest-pool-workers 0.18 · Lighthouse CI · Node 24+ (dev machine has Node 25)

**Spec:** `docs/superpowers/specs/2026-07-20-ctto-prototype-design.md` (approved). Read it first.

## Global Constraints

- **FAST:** interactive map < 2.5 s on mid-range Android on 4G; total client JS ≤ 400 KiB gzip (enforced by `scripts/check-bundle-size.mjs`); verdict tap visually acknowledged < 50 ms; Lighthouse mobile performance target ≥ 90 (CI asserts median-of-3 ≥ 0.85 to absorb runner noise).
- **EASY:** the minimum meaningful ask is ONE TAP. Tapping a verdict IS the submission. Photo and note are optional and clearly skippable.
- **FUN:** map + UI motion at native display refresh (never capped at 60 fps): all bespoke animation is delta-time-based; UI motion animates `transform`/`opacity` only; main-thread work during interaction fits an 8.3 ms frame budget.
- **Verdicts:** exactly `'present' | 'absent' | 'unclear'` everywhere (DB CHECK, API, client).
- **Identity:** anonymous device UUID in localStorage; no auth. `devices.nickname` stays NULL today.
- **Data flow:** promise data is static (`static/data/sites.json`); only submissions/status are dynamic. Server validates submissions against the same sites.json.
- **condition_key:** first 16 hex chars of SHA-256 of `` `${aic_ref}|${condition_type}|${raw_text}` `` — never aic.db row ids.
- **Resilience:** failed submission POSTs queue in localStorage and retry; no dead-end empty states.
- **Repo policy:** after Task 1's bootstrap push, ALL changes land via PR gated on the `tests`, `bundle-size`, `lighthouse` checks. Do not push to main directly after protection is on.
- **Names (use verbatim):** worker/app `did-they-build-it` · D1 `did-they-build-it-db` (binding `DB`) · R2 `did-they-build-it-photos` (binding `BUCKET`) · GitHub repo `did-they-build-it-frontend`.
- **Out of scope today:** auth/nicknames, public photo display (counts only), offline tiles/PWA, rate limiting beyond device dedupe, admin UI, moderation.

## Execution protocol (read before Task 2)

Task 1 lands directly on `main` (bootstrap exception), then enables branch protection. From Task 2 onward, per task:

1. `git checkout -b task/<n>-<slug>` (branch from the latest local state — tasks are sequential and may stack).
2. Do the task's steps (TDD; commit locally as you go).
3. Run the local gate before pushing: `npm test && npm run test:workers && npm run build && npm run check:size` (skip `test:workers` before Task 4 introduces it).
4. `git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash`.
5. `gh pr checks --watch` — you may start the next (dependent) task locally while checks run, but if CI fails, fix that PR before opening the next one. Protection uses `strict: false` precisely so stacked work doesn't force rebase churn today; flip to `strict: true` post-demo.

## File structure

```
did-they-build-it-frontend/
├── .github/workflows/ci.yml            # PR gates: tests, bundle-size, lighthouse
├── .github/workflows/deploy.yml        # merge to main → migrations + wrangler deploy
├── .lighthouserc.json
├── wrangler.jsonc                      # Workers + assets + D1 + R2 bindings
├── vite.config.ts                      # sveltekit() with adapter-cloudflare inline
├── vitest.config.ts                    # unit tests (node env): etl + client logic
├── vitest.workers.config.ts            # workers pool: server logic vs real local D1/R2
├── migrations/0001_init.sql            # D1 schema (devices, submissions)
├── scripts/check-bundle-size.mjs       # deterministic 400 KiB gzip gate
├── etl/build-sites.ts                  # CLI: aic.db → static/data/sites.json
├── etl/transform.ts                    # pure: rows → SiteFeature (testable)
├── etl/mtm.ts                          # EPSG:2019 → WGS84 (proj4)
├── etl/overrides.json                  # manual {aicRef: {lat,lng}} coordinate fixes
├── static/data/sites.json              # ETL output (committed)
├── src/app.d.ts                        # Platform typing (scaffolded, Env-based)
├── src/app.css                         # design tokens + base styles
├── src/lib/types.ts                    # shared domain types
├── src/lib/geo.ts                      # haversine + distance formatting
├── src/lib/device.ts                   # anonymous device UUID
├── src/lib/queue.ts                    # offline-safe submission queue (injectable deps)
├── src/lib/status.ts                   # pure status math (site ring, count labels)
├── src/lib/confetti.ts                 # delta-time canvas confetti burst
├── src/lib/photo.ts                    # client-side downscale to ≤1600px JPEG
├── src/lib/app-state.svelte.ts         # runes store: sites, statusCounts, userPos, tally
├── src/lib/components/MapCanvas.svelte # MapLibre map, clustered pins, status rings
├── src/lib/components/SiteSheet.svelte # bottom sheet: site header + condition cards
├── src/lib/components/ConditionCard.svelte  # the one-tap verify card
├── src/lib/components/NearbyList.svelte     # distance-sorted list sheet
├── src/lib/components/Toast.svelte
├── src/lib/server/submissions.ts       # D1 logic: submitVerdict, statusCounts, attachPhoto
├── src/lib/server/validate.ts          # payload + sites.json target validation
├── src/routes/(map)/+layout.svelte     # persistent map shell (map never remounts)
├── src/routes/(map)/+layout.ts         # universal load: fetch /data/sites.json
├── src/routes/(map)/+page.svelte       # home (map only)
├── src/routes/(map)/site/[siteId]/+page.svelte  # deep-linkable open sheet
├── src/routes/qr/+page.svelte          # printable QR code for the venue
├── src/routes/api/submissions/+server.ts
├── src/routes/api/status/+server.ts
├── src/routes/api/photos/+server.ts
├── tests/unit/*.test.ts
└── tests/workers/                      # apply-migrations.ts, env.d.ts, tsconfig.json, *.test.ts
```

---

### Task 1: Scaffold, CI gates, GitHub repo, branch protection

**Files:**
- Create: entire SvelteKit scaffold (via `sv create`), `wrangler.jsonc` (edited), `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.lighthouserc.json`, `scripts/check-bundle-size.mjs`, `vitest.config.ts`, `.gitignore` additions
- Modify: `package.json` (scripts, deps)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `gen`, `test`, `check:size`; wrangler bindings `platform.env.DB` (D1), `platform.env.BUCKET` (R2); CI check names `tests`, `bundle-size`, `lighthouse` — all later tasks rely on these exact names.

- [ ] **Step 1: Scaffold into a temp dir and merge into this repo** (the repo root already has `docs/` and `.claude/`, so scaffold beside it and move contents in; `rsync` excludes the scaffold's fresh `.git`):

```bash
cd /home/alex/repos/did-they-built-it/did-they-build-it-frontend
SCAFFOLD=$(mktemp -d)/app
npx sv create "$SCAFFOLD" --template minimal --types ts \
  --add sveltekit-adapter="adapter:cloudflare+cfTarget:workers" --no-install
rsync -a --exclude .git "$SCAFFOLD"/ ./
rm -rf "$(dirname "$SCAFFOLD")"
npm install
npm install maplibre-gl proj4 qrcode
npm install -D vitest@^4.1.0 @types/proj4 @types/qrcode
```

Note: `sv create` emits `wrangler.jsonc`, `vite.config.ts` (adapter configured inline — there is NO `svelte.config.js` in current scaffolds; don't add one), `src/app.d.ts` typed against the generated `Env`, and scripts `dev`/`build`/`preview`/`gen`. `build` runs `wrangler types --check && vite build`.

- [ ] **Step 2: Replace `wrangler.jsonc`** (placeholder `database_id` is fine until Task 12 provisions the real one — local dev/tests never need it):

```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "did-they-build-it",
	"compatibility_date": "2026-07-20",
	"compatibility_flags": ["nodejs_als"],
	"main": ".svelte-kit/cloudflare/_worker.js",
	"assets": { "binding": "ASSETS", "directory": ".svelte-kit/cloudflare" },
	"workers_dev": true,
	"preview_urls": true,
	"observability": { "enabled": true },
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "did-they-build-it-db",
			"database_id": "00000000-0000-0000-0000-000000000000",
			"migrations_dir": "migrations"
		}
	],
	"r2_buckets": [{ "binding": "BUCKET", "bucket_name": "did-they-build-it-photos" }]
}
```

Then `npm run gen` (regenerates `worker-configuration.d.ts` so `platform.env.DB`/`BUCKET` typecheck) and `mkdir -p migrations`.

- [ ] **Step 3: Add `vitest.config.ts` (unit tests, node env) and npm scripts**

```ts
// vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Unit tests import src/lib modules that use SvelteKit's $lib alias;
		// this config has no sveltekit() plugin, so declare the alias directly.
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
		passWithNoTests: true
	}
});
```

In `package.json` add to `"scripts"`:

```json
"test": "vitest run",
"test:workers": "vitest run --config vitest.workers.config.ts",
"check:size": "node scripts/check-bundle-size.mjs",
"etl": "node etl/build-sites.ts ../aic-database/data/aic.db"
```

(`test:workers` and `etl` targets arrive in Tasks 4 and 2/3; declaring the scripts now keeps CI stable.)

- [ ] **Step 4: Add `scripts/check-bundle-size.mjs`** (deterministic gzip gate; zero deps):

```js
#!/usr/bin/env node
// Deterministic bundle-size gate: total gzipped client JS must fit the budget.
// Run after `npm run build`. Exits 1 if over budget, 2 on misuse.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { constants, gzipSync } from 'node:zlib';

const BUDGET_BYTES = 400 * 1024; // 400 KiB gzip — founding performance budget
const CLIENT_DIR = '.svelte-kit/output/client/_app/immutable';

let entries;
try {
	entries = readdirSync(CLIENT_DIR, { recursive: true });
} catch {
	console.error(`error: ${CLIENT_DIR} not found — run \`npm run build\` first`);
	process.exit(2);
}

const files = entries
	.map(String)
	.map((name) => join(CLIENT_DIR, name))
	.filter((p) => p.endsWith('.js') && statSync(p).isFile())
	.sort();

if (files.length === 0) {
	console.error(`error: no .js files under ${CLIENT_DIR} — build looks broken`);
	process.exit(2);
}

const rows = files
	.map((file) => ({
		file: relative(CLIENT_DIR, file),
		gzip: gzipSync(readFileSync(file), { level: constants.Z_BEST_COMPRESSION }).length
	}))
	.sort((a, b) => b.gzip - a.gzip);

const total = rows.reduce((sum, row) => sum + row.gzip, 0);
const kib = (n) => (n / 1024).toFixed(1);

for (const { file, gzip } of rows) console.log(`${String(gzip).padStart(9)} B gzip  ${file}`);
console.log('-'.repeat(60));
console.log(`total: ${total} B gzip (${kib(total)} KiB) / budget ${BUDGET_BYTES} B (${kib(BUDGET_BYTES)} KiB)`);

if (total > BUDGET_BYTES) {
	console.error(`FAIL: client JS over budget by ${total - BUDGET_BYTES} B gzip`);
	process.exit(1);
}
console.log('OK: within budget');
```

- [ ] **Step 5: Add `.lighthouserc.json`** (mobile emulation is Lighthouse's default; `wrangler dev` serves the real built worker so `/api/*` works; LHCI matches its ready-pattern case-insensitively):

```json
{
	"ci": {
		"collect": {
			"numberOfRuns": 3,
			"startServerCommand": "npx wrangler dev --port 8787",
			"startServerReadyPattern": "Ready on",
			"startServerReadyTimeout": 60000,
			"url": ["http://localhost:8787/"],
			"settings": { "chromeFlags": "--no-sandbox" }
		},
		"assert": {
			"assertions": {
				"categories:performance": ["error", { "minScore": 0.85, "aggregationMethod": "median" }]
			}
		},
		"upload": { "target": "temporary-public-storage" }
	}
}
```

- [ ] **Step 6: Add `.github/workflows/ci.yml`** (job names ARE the protection contexts — do not rename):

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  tests:
    name: tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Unit tests (node)
        run: npm test

  bundle-size:
    name: bundle-size
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Production build
        run: npm run build
      - name: Enforce 400 KiB gzip client JS budget
        run: npm run check:size

  lighthouse:
    name: lighthouse
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Production build (Cloudflare adapter)
        run: npm run build
      - name: Local D1 schema so API routes work under wrangler dev
        # Guarded: the migrations dir is empty until Task 4 lands its first .sql
        run: |
          if ls migrations/*.sql >/dev/null 2>&1; then
            npx wrangler d1 migrations apply did-they-build-it-db --local
          else
            echo "no migrations yet — skipping"
          fi
        env:
          WRANGLER_SEND_METRICS: 'false'
      - name: Lighthouse CI (median of 3, mobile emulation, perf >= 0.85)
        run: npx --yes @lhci/cli@0.15.1 autorun
        env:
          WRANGLER_SEND_METRICS: 'false'
```

(The migrations step is a no-op until Task 4 adds `migrations/0001_init.sql` — `wrangler d1 migrations apply` exits 0 with no migrations.)

- [ ] **Step 7: Add `.github/workflows/deploy.yml`** (fires only on commits that passed the PR gates):

```yaml
name: Deploy

on:
  push:
    branches: [main]

concurrency:
  group: production-deploy
  cancel-in-progress: false

jobs:
  deploy:
    name: deploy
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Build SvelteKit (Cloudflare adapter)
        run: npm run build
      - name: Apply D1 migrations (production)
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply did-they-build-it-db --remote
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

(This workflow fails until Task 12 sets the two secrets and the real `database_id` — that's expected; deploys are Task 12's deliverable.)

- [ ] **Step 8: Verify the scaffold works end-to-end locally**

Run: `npm run build && npm run check:size`
Expected: build succeeds; size gate prints per-file sizes and `OK: within budget` (scaffold is ~50 KiB).

Run: `npm test`
Expected: exit 0 (`passWithNoTests`).

- [ ] **Step 9: Commit and push bootstrap to a new GitHub repo**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit on Cloudflare Workers with CI gates"
gh repo create did-they-build-it-frontend --public --source . --remote origin --push
```

(`--public` because this is a civic-tech project meant for contributors; use `--private` if the user prefers.)

- [ ] **Step 10: Wait for the first CI run to go green, then protect main**

```bash
gh run list --workflow=ci.yml --limit 1   # note the run ID
gh run watch <RUN_ID> --exit-status || gh run view <RUN_ID> --log-failed
```

Expected: `tests`, `bundle-size`, `lighthouse` all pass on the bootstrap commit (lighthouse audits the scaffold page; the separate Deploy workflow fails — ignore it, see Step 7 note). Then:

```bash
gh repo edit --enable-auto-merge
gh api --method PUT -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  repos/{owner}/{repo}/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "checks": [
      { "context": "tests", "app_id": 15368 },
      { "context": "lighthouse", "app_id": 15368 },
      { "context": "bundle-size", "app_id": 15368 }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
gh api repos/{owner}/{repo}/branches/main/protection \
  --jq '{checks: .required_status_checks.checks, enforce_admins: .enforce_admins.enabled}'
```

Expected: the verify call prints the three contexts and `"enforce_admins": false`. (`app_id: 15368` pins the checks to GitHub Actions; `strict: false` per the Execution protocol; admins keep an emergency bypass.)

---

### Task 2: Shared types + ETL pure helpers (coordinates, keys, formatting)

**Files:**
- Create: `src/lib/types.ts`, `etl/mtm.ts`, `etl/transform.ts`, `etl/overrides.json`
- Test: `tests/unit/mtm.test.ts`, `tests/unit/transform.test.ts`

**Interfaces:**
- Produces: `mtm10ToWgs84(x: number, y: number): { lat: number; lng: number }`; `conditionKey(aicRef: string, type: string, rawText: string): string` (16 hex chars); `formatAddress(md: Record<string, unknown>): string`; `siteFromApplication(app: AppRow, conditionRows: ConditionRow[], overrides: Overrides): { feature: SiteFeature } | { miss: string }`; all domain types in `src/lib/types.ts` (used by every later task).

- [ ] **Step 1: Write `src/lib/types.ts`** (no test — types only):

```ts
export const CONDITION_TYPES = [
	'landscaping',
	'bike_parking',
	'public_art',
	'street_furniture',
	'pavers'
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export interface SiteCondition {
	key: string; // stable 16-hex condition_key
	type: ConditionType;
	description: string;
	rawText: string;
	sourceUrl: string; // toronto.ca legdocs PDF
}

export interface SiteProperties {
	siteId: string; // slugged aic_ref, e.g. "21-208078-ste-10-oz"
	address: string; // display form, e.g. "147 Spadina Ave"
	aicRef: string;
	ward: string;
	status: string | null; // e.g. "Closed", "Council Approved"
	appliedYear: number | null;
	conditions: SiteCondition[];
}

export interface SiteFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
	properties: SiteProperties;
}

export interface SitesCollection {
	type: 'FeatureCollection';
	generated: string; // ISO timestamp of the ETL run
	features: SiteFeature[];
}

export type Verdict = 'present' | 'absent' | 'unclear';
export const VERDICTS: readonly Verdict[] = ['present', 'absent', 'unclear'];

export interface StatusCounts {
	present: number;
	absent: number;
	unclear: number;
	photos: number;
}

export interface SubmissionPayload {
	deviceId: string;
	siteId: string;
	conditionKey: string;
	verdict: Verdict;
	note?: string | null;
	lat?: number | null;
	lng?: number | null;
	accuracyM?: number | null;
}
```

- [ ] **Step 2: Write failing tests for the coordinate conversion.** The expected values were independently validated against PROJ's authoritative NTv2 grid transform (max deviation 0.9 m):

```ts
// tests/unit/mtm.test.ts
import { describe, expect, it } from 'vitest';
import { mtm10ToWgs84 } from '../../etl/mtm';

// Ground truth: pyproj EPSG:2019 -> EPSG:4326 with the ca_nrc_MAY76V20 grid.
const CASES: Array<{ name: string; x: number; y: number; lat: number; lng: number }> = [
	{ name: '147 Spadina Ave', x: 313206.52, y: 4834020.264, lat: 43.64808, lng: -79.395565 },
	{ name: '64 Bathurst St', x: 312647.294, y: 4833422.48, lat: 43.642652, lng: -79.402444 },
	{ name: '121 St Patrick St', x: 313686.943, y: 4834620.623, lat: 43.653514, lng: -79.389696 }
];

// ~30 m in degrees at Toronto's latitude — generous vs the validated <1 m fit,
// tight enough to catch a wrong datum (~200 m) or a wrong zone (kilometres).
const EPS = 0.0003;

describe('mtm10ToWgs84 (EPSG:2019 → WGS84)', () => {
	for (const c of CASES) {
		it(`converts ${c.name}`, () => {
			const { lat, lng } = mtm10ToWgs84(c.x, c.y);
			expect(Math.abs(lat - c.lat)).toBeLessThan(EPS);
			expect(Math.abs(lng - c.lng)).toBeLessThan(EPS);
		});
	}
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/mtm.test.ts`
Expected: FAIL — cannot resolve `../../etl/mtm`.

- [ ] **Step 4: Implement `etl/mtm.ts`**

```ts
import proj4 from 'proj4';

// City of Toronto Development Applications X/Y: EPSG:2019 (NAD27(76) / MTM zone 10).
// towgs84=-10,158,187 reproduces PROJ's authoritative NTv2 grid transform
// (ca_nrc_MAY76V20) to <0.9 m across Toronto. Do not reuse far outside the GTA.
const EPSG_2019 =
	'+proj=tmerc +lat_0=0 +lon_0=-79.5 +k=0.9999 +x_0=304800 +y_0=0 ' +
	'+ellps=clrk66 +towgs84=-10,158,187 +units=m +no_defs';

export function mtm10ToWgs84(x: number, y: number): { lat: number; lng: number } {
	const [lng, lat] = proj4(EPSG_2019, 'EPSG:4326', [x, y]);
	return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/mtm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write failing tests for the transform helpers**

```ts
// tests/unit/transform.test.ts
import { describe, expect, it } from 'vitest';
import { conditionKey, formatAddress, siteFromApplication } from '../../etl/transform';
import type { AppRow, ConditionRow } from '../../etl/transform';

const APP: AppRow = {
	id: 15,
	aic_ref: '21 208078 STE 10 OZ',
	ward: '10',
	status: 'OMB Appeal',
	raw_metadata_json: JSON.stringify({
		STREET_NUM: '147',
		STREET_NAME: 'SPADINA',
		STREET_TYPE: 'AVE',
		STREET_DIRECTION: ' ', // blank direction is a single space in the source data
		DATE_SUBMITTED: '2021-09-03T00:00:00',
		X: 313206.52,
		Y: 4834020.264
	})
};

const COND: ConditionRow = {
	condition_type: 'landscaping',
	raw_text: 'the owner has worked with City Planning… to conserve City trees;',
	description: 'Conserve existing trees and submit a replacement plan if removal is needed.',
	url: 'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-239581.pdf'
};

describe('conditionKey', () => {
	it('is 16 lowercase hex chars and deterministic', () => {
		const k = conditionKey('21 208078 STE 10 OZ', 'landscaping', 'some raw text');
		expect(k).toMatch(/^[0-9a-f]{16}$/);
		expect(conditionKey('21 208078 STE 10 OZ', 'landscaping', 'some raw text')).toBe(k);
	});
	it('changes when any component changes', () => {
		const k = conditionKey('a', 'b', 'c');
		expect(conditionKey('a', 'b', 'd')).not.toBe(k);
		expect(conditionKey('a', 'x', 'c')).not.toBe(k);
	});
});

describe('formatAddress', () => {
	it('title-cases and trims blank direction', () => {
		expect(formatAddress(JSON.parse(APP.raw_metadata_json))).toBe('147 Spadina Ave');
	});
	it('keeps single-letter direction uppercase', () => {
		expect(
			formatAddress({ STREET_NUM: '580', STREET_NAME: 'FRONT', STREET_TYPE: 'ST', STREET_DIRECTION: 'W' })
		).toBe('580 Front St W');
	});
});

describe('siteFromApplication', () => {
	it('builds a GeoJSON feature with converted coordinates', () => {
		const out = siteFromApplication(APP, [COND], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		const f = out.feature;
		expect(f.properties.siteId).toBe('21-208078-ste-10-oz');
		expect(f.properties.address).toBe('147 Spadina Ave');
		expect(f.properties.appliedYear).toBe(2021);
		expect(f.geometry.coordinates[0]).toBeCloseTo(-79.395565, 3); // lng
		expect(f.geometry.coordinates[1]).toBeCloseTo(43.64808, 3); // lat
		expect(f.properties.conditions).toHaveLength(1);
		expect(f.properties.conditions[0].type).toBe('landscaping');
		expect(f.properties.conditions[0].key).toMatch(/^[0-9a-f]{16}$/);
	});
	it('dedupes identical (type, raw_text) conditions from multiple report versions', () => {
		const out = siteFromApplication(APP, [COND, { ...COND }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions).toHaveLength(1);
	});
	it('prefers a manual override over metadata X/Y', () => {
		const out = siteFromApplication(APP, [COND], {
			'21 208078 STE 10 OZ': { lat: 43.9, lng: -79.1 }
		});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.geometry.coordinates).toEqual([-79.1, 43.9]);
	});
	it('reports a miss when X/Y are absent and no override exists', () => {
		const noXY: AppRow = { ...APP, raw_metadata_json: JSON.stringify({ STREET_NUM: '1', STREET_NAME: 'X' }) };
		const out = siteFromApplication(noXY, [COND], {});
		expect('miss' in out && out.miss).toContain('21 208078 STE 10 OZ');
	});
	it('falls back to raw_text when description is null', () => {
		const out = siteFromApplication(APP, [{ ...COND, description: null }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions[0].description).toBe(COND.raw_text);
	});
});
```

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run tests/unit/transform.test.ts`
Expected: FAIL — cannot resolve `../../etl/transform`.

- [ ] **Step 8: Implement `etl/transform.ts`**

```ts
// NOTE: etl/ files use explicit .ts extensions and relative paths (no $lib) so
// they run under plain `node` (native type stripping needs full specifiers).
import { createHash } from 'node:crypto';
import type { ConditionType, SiteCondition, SiteFeature } from '../src/lib/types.ts';
import { CONDITION_TYPES } from '../src/lib/types.ts';
import { mtm10ToWgs84 } from './mtm.ts';

export interface AppRow {
	id: number;
	aic_ref: string;
	ward: string | null;
	status: string | null;
	raw_metadata_json: string;
}

export interface ConditionRow {
	condition_type: string;
	raw_text: string;
	description: string | null;
	url: string;
}

export type Overrides = Record<string, { lat: number; lng: number }>;

export function conditionKey(aicRef: string, type: string, rawText: string): string {
	return createHash('sha256').update(`${aicRef}|${type}|${rawText}`).digest('hex').slice(0, 16);
}

export function formatAddress(md: Record<string, unknown>): string {
	const title = (s: string) =>
		s
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean)
			.map((w) => (w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
			.join(' ');
	const parts = [
		String(md.STREET_NUM ?? '').trim(),
		title(String(md.STREET_NAME ?? '').trim()),
		title(String(md.STREET_TYPE ?? '').trim()),
		String(md.STREET_DIRECTION ?? '').trim().toUpperCase()
	];
	return parts.filter(Boolean).join(' ');
}

export function siteFromApplication(
	app: AppRow,
	conditionRows: ConditionRow[],
	overrides: Overrides
): { feature: SiteFeature } | { miss: string } {
	const md = JSON.parse(app.raw_metadata_json ?? '{}') as Record<string, unknown>;

	const override = overrides[app.aic_ref];
	const x = Number(md.X);
	const y = Number(md.Y);
	let lat: number, lng: number;
	if (override) {
		({ lat, lng } = override);
	} else if (Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0) {
		({ lat, lng } = mtm10ToWgs84(x, y));
	} else {
		return { miss: `${app.aic_ref}: no X/Y in metadata and no override` };
	}

	const seen = new Set<string>();
	const conditions: SiteCondition[] = [];
	for (const row of conditionRows) {
		const key = conditionKey(app.aic_ref, row.condition_type, row.raw_text);
		if (seen.has(key)) continue; // same condition in multiple report versions
		seen.add(key);
		conditions.push({
			key,
			type: (CONDITION_TYPES as readonly string[]).includes(row.condition_type)
				? (row.condition_type as ConditionType)
				: 'landscaping',
			description: row.description ?? row.raw_text,
			rawText: row.raw_text,
			sourceUrl: row.url
		});
	}

	const submitted = String(md.DATE_SUBMITTED ?? '');
	const appliedYear = /^\d{4}/.test(submitted) ? Number(submitted.slice(0, 4)) : null;

	return {
		feature: {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [lng, lat] },
			properties: {
				siteId: app.aic_ref.toLowerCase().replace(/\s+/g, '-'),
				address: formatAddress(md),
				aicRef: app.aic_ref,
				ward: app.ward ?? '',
				status: app.status,
				appliedYear,
				conditions
			}
		}
	};
}
```

- [ ] **Step 9: Create `etl/overrides.json`** containing exactly `{}` (populated only when a site's pin lands wrong in the field).

- [ ] **Step 10: Run all unit tests to verify pass**

Run: `npm test`
Expected: PASS (mtm + transform suites).

- [ ] **Step 11: Commit, open PR per Execution protocol**

```bash
git checkout -b task/2-etl-transform
git add src/lib/types.ts etl/ tests/unit/
git commit -m "feat: shared types + ETL transforms (EPSG:2019 conversion, condition keys)"
npm test && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 3: ETL CLI — read aic.db, emit static/data/sites.json

**Files:**
- Create: `etl/build-sites.ts`, `static/data/sites.json` (generated)
- Test: `tests/unit/build-sites.test.ts`

**Interfaces:**
- Consumes: `siteFromApplication`, `Overrides` from `etl/transform.ts`.
- Produces: `readSites(db: DatabaseSyncLike, overrides: Overrides): { features: SiteFeature[]; misses: string[] }` and the committed `static/data/sites.json` (`SitesCollection`) that the app (Task 5 server validation, Task 6 map) reads.

- [ ] **Step 1: Write the failing test.** Node's built-in `node:sqlite` supports `:memory:`, so the test builds a miniature aic.db and runs the real reader against it:

```ts
// tests/unit/build-sites.test.ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readSites } from '../../etl/build-sites';

function fixtureDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec(`
		CREATE TABLE applications (id INTEGER PRIMARY KEY, aic_ref TEXT, ward TEXT,
			status TEXT, raw_metadata_json TEXT);
		CREATE TABLE documents (id INTEGER PRIMARY KEY, application_id INTEGER, url TEXT);
		CREATE TABLE conditions (id INTEGER PRIMARY KEY, application_id INTEGER,
			document_id INTEGER, condition_type TEXT, raw_text TEXT, description TEXT,
			physically_verifiable INTEGER);
	`);
	db.prepare(
		`INSERT INTO applications VALUES (1, '21 208078 STE 10 OZ', '10', 'Closed', ?)`
	).run(
		JSON.stringify({
			STREET_NUM: '147', STREET_NAME: 'SPADINA', STREET_TYPE: 'AVE',
			STREET_DIRECTION: ' ', DATE_SUBMITTED: '2021-09-03T00:00:00',
			X: 313206.52, Y: 4834020.264
		})
	);
	db.prepare(`INSERT INTO documents VALUES (1, 1, 'https://example.com/report.pdf')`).run();
	db.prepare(
		`INSERT INTO conditions VALUES (1, 1, 1, 'landscaping', 'plant trees', 'Plant trees.', 1)`
	).run();
	db.prepare(
		`INSERT INTO conditions VALUES (2, 1, 1, 'cash_contribution', 'pay money', 'Pay.', 0)`
	).run(); // physically_verifiable = 0 → must be excluded
	return db;
}

describe('readSites', () => {
	it('emits one feature per application with verifiable conditions only', () => {
		const { features, misses } = readSites(fixtureDb(), {});
		expect(misses).toEqual([]);
		expect(features).toHaveLength(1);
		expect(features[0].properties.conditions).toHaveLength(1);
		expect(features[0].properties.conditions[0].type).toBe('landscaping');
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/build-sites.test.ts`
Expected: FAIL — cannot resolve `../../etl/build-sites`.

- [ ] **Step 3: Implement `etl/build-sites.ts`** (importable `readSites` + CLI entry):

```ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { SiteFeature, SitesCollection } from '../src/lib/types.ts';
import { siteFromApplication, type AppRow, type ConditionRow, type Overrides } from './transform.ts';

// Narrow structural type so tests can pass an in-memory DatabaseSync.
export type DatabaseSyncLike = Pick<DatabaseSync, 'prepare'>;

export function readSites(
	db: DatabaseSyncLike,
	overrides: Overrides
): { features: SiteFeature[]; misses: string[] } {
	const apps = db
		.prepare(
			`SELECT a.id, a.aic_ref, a.ward, a.status, a.raw_metadata_json
			 FROM applications a
			 WHERE EXISTS (SELECT 1 FROM conditions c
			               WHERE c.application_id = a.id AND c.physically_verifiable = 1)
			 ORDER BY a.aic_ref`
		)
		.all() as unknown as AppRow[];

	const condStmt = db.prepare(
		`SELECT c.condition_type, c.raw_text, c.description, d.url
		 FROM conditions c JOIN documents d ON d.id = c.document_id
		 WHERE c.application_id = ? AND c.physically_verifiable = 1
		 ORDER BY c.id`
	);

	const features: SiteFeature[] = [];
	const misses: string[] = [];
	for (const app of apps) {
		const conditions = condStmt.all(app.id) as unknown as ConditionRow[];
		const out = siteFromApplication(app, conditions, overrides);
		if ('feature' in out) features.push(out.feature);
		else misses.push(out.miss);
	}
	return { features, misses };
}

// ---- CLI: node etl/build-sites.ts <path-to-aic.db> ----
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const dbPath = process.argv[2];
	if (!dbPath) {
		console.error('usage: node etl/build-sites.ts <path-to-aic.db>');
		process.exit(2);
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const overrides = JSON.parse(
		readFileSync(join(here, 'overrides.json'), 'utf8')
	) as Overrides;

	const db = new DatabaseSync(dbPath, { readOnly: true });
	const { features, misses } = readSites(db, overrides);

	const collection: SitesCollection = {
		type: 'FeatureCollection',
		generated: new Date().toISOString(),
		features
	};
	const outPath = join(here, '..', 'static', 'data', 'sites.json');
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(collection));

	const nConditions = features.reduce((n, f) => n + f.properties.conditions.length, 0);
	console.log(`sites.json: ${features.length} sites, ${nConditions} conditions -> ${outPath}`);
	if (misses.length > 0) {
		console.error(`\nWARNING — ${misses.length} application(s) skipped (no coordinates):`);
		for (const m of misses) console.error(`  - ${m}`);
		console.error('Add entries to etl/overrides.json to place them manually.');
	}
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Run the real ETL and eyeball the output**

Run: `npm run etl`
Expected output like: `sites.json: 20 sites, ~70 conditions -> …/static/data/sites.json`, zero WARNING lines (all 20 apps have X/Y). Spot-check: `node -e "const s=require('./static/data/sites.json'); console.log(s.features[0].properties.address, s.features[0].geometry.coordinates)"` prints a downtown address with lng ≈ -79.4, lat ≈ 43.64.

- [ ] **Step 6: Commit (INCLUDING generated sites.json), PR**

```bash
git checkout -b task/3-etl-cli
git add etl/ tests/unit/build-sites.test.ts static/data/sites.json
git commit -m "feat: ETL CLI emitting static/data/sites.json from aic.db"
npm test && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 4: D1 schema + server submission logic (workers-pool tests against real local D1)

**Files:**
- Create: `migrations/0001_init.sql`, `src/lib/server/submissions.ts`, `vitest.workers.config.ts`, `tests/workers/apply-migrations.ts`, `tests/workers/env.d.ts`, `tests/workers/tsconfig.json`
- Modify: `.github/workflows/ci.yml` (tests job), `package.json` (devDeps)
- Test: `tests/workers/submissions.test.ts`

**Interfaces:**
- Produces: `submitVerdict(db: D1Database, input: SubmissionInput): Promise<{ id: string }>`; `allStatusCounts(db: D1Database): Promise<Record<string, StatusCounts>>`; `attachPhoto(db: D1Database, submissionId: string, deviceId: string, photoKey: string): Promise<boolean>`; `SubmissionInput` type. Task 5's routes call exactly these.

- [ ] **Step 1: Install the workers test pool** (NOTE: the old `defineWorkersConfig` API from `@cloudflare/vitest-pool-workers/config` no longer exists in 0.18.x — the current API is the `cloudflareTest` Vite plugin, and storage isolation is per test FILE):

```bash
npm install -D @cloudflare/vitest-pool-workers@^0.18.6 @cloudflare/workers-types
```

- [ ] **Step 2: Write `migrations/0001_init.sql`** (exact spec schema):

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  nickname TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  condition_key TEXT NOT NULL,
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('present','absent','unclear')),
  note TEXT,
  photo_key TEXT,
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  created_at TEXT NOT NULL,
  UNIQUE (device_id, condition_key)
);

CREATE INDEX idx_submissions_condition ON submissions (condition_key);
CREATE INDEX idx_submissions_site ON submissions (site_id);
```

- [ ] **Step 3: Write `vitest.workers.config.ts` + setup + typing files**

```ts
// vitest.workers.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
	const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));
	const migrations = await readD1Migrations(migrationsPath);

	return {
		resolve: {
			// Server modules under test may import from $lib; no sveltekit() plugin
			// here, so declare the alias directly (mirrors vitest.config.ts).
			alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
		},
		plugins: [
			cloudflareTest({
				// Deliberately NOT wrangler.jsonc: its `main` points at the built
				// .svelte-kit/cloudflare/_worker.js, which need not exist at test time.
				miniflare: {
					compatibilityDate: '2026-07-01',
					compatibilityFlags: ['nodejs_als'],
					d1Databases: ['DB'],
					r2Buckets: ['BUCKET'],
					bindings: { TEST_MIGRATIONS: migrations }
				}
			})
		],
		test: {
			include: ['tests/workers/**/*.test.ts'],
			setupFiles: ['./tests/workers/apply-migrations.ts']
		}
	};
});
```

```ts
// tests/workers/apply-migrations.ts
// applyD1Migrations() only applies not-yet-applied migrations, so re-runs are safe.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

```ts
// tests/workers/env.d.ts
declare namespace Cloudflare {
	interface Env {
		DB: D1Database;
		BUCKET: R2Bucket;
		TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
	}
}
```

```json
// tests/workers/tsconfig.json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"moduleResolution": "bundler",
		"types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"]
	},
	"include": ["./**/*.ts", "../../src/lib/server/**/*.ts", "../../src/lib/types.ts"]
}
```

- [ ] **Step 4: Write the failing test** (tests within one file share D1 state and run in order; other files get a pristine copy):

```ts
// tests/workers/submissions.test.ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { allStatusCounts, attachPhoto, submitVerdict } from '../../src/lib/server/submissions';

const base = {
	siteId: '21-208078-ste-10-oz',
	conditionKey: 'abcd1234abcd1234',
	deviceId: 'device-1'
};

describe('submissions (real local D1)', () => {
	it('records a one-tap verdict and returns a submission id', async () => {
		const { id } = await submitVerdict(env.DB, { ...base, verdict: 'present' });
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234']).toEqual({ present: 1, absent: 0, unclear: 0, photos: 0 });
	});

	it('re-submitting from the same device updates, not duplicates, and keeps the id', async () => {
		const first = await submitVerdict(env.DB, { ...base, verdict: 'present' });
		const second = await submitVerdict(env.DB, { ...base, verdict: 'absent' });
		expect(second.id).toBe(first.id);
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234']).toEqual({ present: 0, absent: 1, unclear: 0, photos: 0 });
	});

	it('different devices count separately; notes and location are stored', async () => {
		await submitVerdict(env.DB, {
			...base,
			deviceId: 'device-2',
			verdict: 'present',
			note: 'Racks are by the back door',
			lat: 43.648,
			lng: -79.395,
			accuracyM: 12
		});
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234'].present).toBe(1);
		expect(counts['abcd1234abcd1234'].absent).toBe(1);
	});

	it('attachPhoto sets the key only for the owning device', async () => {
		const { id } = await submitVerdict(env.DB, { ...base, verdict: 'absent' });
		expect(await attachPhoto(env.DB, id, 'WRONG-device', 'photos/x.jpg')).toBe(false);
		expect(await attachPhoto(env.DB, id, 'device-1', 'photos/x.jpg')).toBe(true);
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234'].photos).toBe(1);
	});
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm run test:workers`
Expected: FAIL — cannot resolve `../../src/lib/server/submissions`.

- [ ] **Step 6: Implement `src/lib/server/submissions.ts`**

```ts
import type { StatusCounts, Verdict } from '$lib/types';

export interface SubmissionInput {
	conditionKey: string;
	siteId: string;
	deviceId: string;
	verdict: Verdict;
	note?: string | null;
	lat?: number | null;
	lng?: number | null;
	accuracyM?: number | null;
}

export async function submitVerdict(
	db: D1Database,
	input: SubmissionInput
): Promise<{ id: string }> {
	const now = new Date().toISOString();
	const newId = crypto.randomUUID();
	await db
		.prepare('INSERT INTO devices (id, created_at) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING')
		.bind(input.deviceId, now)
		.run();
	const row = await db
		.prepare(
			`INSERT INTO submissions
				(id, condition_key, site_id, device_id, verdict, note, lat, lng, accuracy_m, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
			 ON CONFLICT (device_id, condition_key) DO UPDATE SET
				verdict = excluded.verdict,
				note = COALESCE(excluded.note, submissions.note),
				lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
				created_at = excluded.created_at
			 RETURNING id`
		)
		.bind(
			newId,
			input.conditionKey,
			input.siteId,
			input.deviceId,
			input.verdict,
			input.note ?? null,
			input.lat ?? null,
			input.lng ?? null,
			input.accuracyM ?? null,
			now
		)
		.first<{ id: string }>();
	return { id: row!.id };
}

export async function allStatusCounts(db: D1Database): Promise<Record<string, StatusCounts>> {
	const { results } = await db
		.prepare(
			`SELECT condition_key,
			        SUM(verdict = 'present') AS present,
			        SUM(verdict = 'absent') AS absent,
			        SUM(verdict = 'unclear') AS unclear,
			        SUM(photo_key IS NOT NULL) AS photos
			 FROM submissions GROUP BY condition_key`
		)
		.all<{ condition_key: string; present: number; absent: number; unclear: number; photos: number }>();
	const out: Record<string, StatusCounts> = {};
	for (const r of results) {
		out[r.condition_key] = {
			present: r.present,
			absent: r.absent,
			unclear: r.unclear,
			photos: r.photos
		};
	}
	return out;
}

export async function attachPhoto(
	db: D1Database,
	submissionId: string,
	deviceId: string,
	photoKey: string
): Promise<boolean> {
	const res = await db
		.prepare('UPDATE submissions SET photo_key = ?1 WHERE id = ?2 AND device_id = ?3')
		.bind(photoKey, submissionId, deviceId)
		.run();
	return res.meta.changes === 1;
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npm run test:workers`
Expected: PASS (4 tests). Also apply migrations to the shared local dev DB so `vite dev`/`wrangler dev` work in later tasks: `npx wrangler d1 migrations apply did-they-build-it-db --local` → "1 migration applied".

- [ ] **Step 8: Add the workers tests to CI.** In `.github/workflows/ci.yml`, `tests` job, append after the unit-test step:

```yaml
      - name: Workers-pool tests (real local D1)
        run: npm run test:workers
```

- [ ] **Step 9: Commit, PR**

```bash
git checkout -b task/4-d1-server-logic
git add migrations/ src/lib/server/submissions.ts vitest.workers.config.ts tests/workers/ .github/workflows/ci.yml package.json package-lock.json
git commit -m "feat: D1 schema + server submission logic with workers-pool tests"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 5: API routes — /api/submissions, /api/status, /api/photos

**Files:**
- Create: `src/lib/server/validate.ts`, `src/routes/api/submissions/+server.ts`, `src/routes/api/status/+server.ts`, `src/routes/api/photos/+server.ts`
- Test: `tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: `submitVerdict`, `allStatusCounts`, `attachPhoto` (Task 4); `static/data/sites.json` (Task 3).
- Produces (HTTP, consumed by client Tasks 8–10):
  - `POST /api/submissions` body `SubmissionPayload` → `201 {"id": "<uuid>"}` | `400 {"error": "..."}`
  - `GET /api/status` → `200 {"conditions": Record<conditionKey, StatusCounts>}` (Cache-Control: no-store)
  - `POST /api/photos?submission=<id>&device=<deviceId>` body image bytes (jpeg/png/webp, ≤ 5 MiB) → `200 {"ok":true}` | `400/403/413`
- Also produces: `parseSubmission(raw: unknown): { ok: true; value: SubmissionPayload } | { ok: false; error: string }`.

- [ ] **Step 1: Write failing validation tests**

```ts
// tests/unit/validate.test.ts
import { describe, expect, it } from 'vitest';
import { parseSubmission } from '../../src/lib/server/validate';
import sites from '../../static/data/sites.json';

// Use a real site/condition from the committed sites.json so validation passes.
const site = sites.features[0].properties;
const good = {
	deviceId: crypto.randomUUID(),
	siteId: site.siteId,
	conditionKey: site.conditions[0].key,
	verdict: 'present'
};

describe('parseSubmission', () => {
	it('accepts a minimal valid payload', () => {
		const r = parseSubmission(good);
		expect(r.ok).toBe(true);
	});
	it('accepts optional note and location', () => {
		const r = parseSubmission({ ...good, note: 'by the door', lat: 43.6, lng: -79.4, accuracyM: 10 });
		expect(r.ok).toBe(true);
	});
	it('rejects unknown verdicts', () => {
		expect(parseSubmission({ ...good, verdict: 'maybe' }).ok).toBe(false);
	});
	it('rejects a condition key that is not in sites.json', () => {
		expect(parseSubmission({ ...good, conditionKey: 'ffffffffffffffff' }).ok).toBe(false);
	});
	it('rejects a mismatched site/condition pair', () => {
		const other = sites.features[1].properties;
		expect(parseSubmission({ ...good, siteId: other.siteId }).ok).toBe(false);
	});
	it('rejects notes over 500 chars and junk coordinates', () => {
		expect(parseSubmission({ ...good, note: 'x'.repeat(501) }).ok).toBe(false);
		expect(parseSubmission({ ...good, lat: 999 }).ok).toBe(false);
	});
	it('rejects non-object input', () => {
		expect(parseSubmission('nope').ok).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/validate.test.ts`
Expected: FAIL — cannot resolve `src/lib/server/validate`.

- [ ] **Step 3: Implement `src/lib/server/validate.ts`** (vite inlines the JSON import into the server bundle — same file the client fetches, so there is nothing to sync):

```ts
import type { SubmissionPayload, Verdict } from '$lib/types';
import { VERDICTS } from '$lib/types';
import sites from '../../../static/data/sites.json';

const validTargets = new Set<string>();
for (const f of sites.features) {
	for (const c of f.properties.conditions) {
		validTargets.add(`${f.properties.siteId}:${c.key}`);
	}
}

const isFiniteIn = (v: unknown, lo: number, hi: number) =>
	typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function parseSubmission(
	raw: unknown
): { ok: true; value: SubmissionPayload } | { ok: false; error: string } {
	if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' };
	const o = raw as Record<string, unknown>;

	if (typeof o.deviceId !== 'string' || o.deviceId.length < 8 || o.deviceId.length > 64)
		return { ok: false, error: 'bad deviceId' };
	if (!VERDICTS.includes(o.verdict as Verdict)) return { ok: false, error: 'bad verdict' };
	if (typeof o.siteId !== 'string' || typeof o.conditionKey !== 'string')
		return { ok: false, error: 'bad target' };
	if (!validTargets.has(`${o.siteId}:${o.conditionKey}`))
		return { ok: false, error: 'unknown site/condition' };
	if (o.note != null && (typeof o.note !== 'string' || o.note.length > 500))
		return { ok: false, error: 'bad note' };
	const hasLat = o.lat != null;
	const hasLng = o.lng != null;
	if (hasLat !== hasLng) return { ok: false, error: 'lat/lng must come together' };
	if (hasLat && (!isFiniteIn(o.lat, -90, 90) || !isFiniteIn(o.lng, -180, 180)))
		return { ok: false, error: 'bad coordinates' };
	if (o.accuracyM != null && !isFiniteIn(o.accuracyM, 0, 100000))
		return { ok: false, error: 'bad accuracy' };

	return {
		ok: true,
		value: {
			deviceId: o.deviceId,
			siteId: o.siteId,
			conditionKey: o.conditionKey,
			verdict: o.verdict as Verdict,
			note: (o.note as string | undefined) ?? null,
			lat: (o.lat as number | undefined) ?? null,
			lng: (o.lng as number | undefined) ?? null,
			accuracyM: (o.accuracyM as number | undefined) ?? null
		}
	};
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/validate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Implement the three routes** (thin wrappers — the logic is already tested):

```ts
// src/routes/api/submissions/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { submitVerdict } from '$lib/server/submissions';
import { parseSubmission } from '$lib/server/validate';

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) return json({ error: 'platform unavailable' }, { status: 500 });
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	const parsed = parseSubmission(raw);
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
	const { id } = await submitVerdict(platform.env.DB, parsed.value);
	return json({ id }, { status: 201 });
};
```

```ts
// src/routes/api/status/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { allStatusCounts } from '$lib/server/submissions';

export const GET: RequestHandler = async ({ platform }) => {
	if (!platform) return json({ error: 'platform unavailable' }, { status: 500 });
	const conditions = await allStatusCounts(platform.env.DB);
	return json({ conditions }, { headers: { 'cache-control': 'no-store' } });
};
```

```ts
// src/routes/api/photos/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachPhoto } from '$lib/server/submissions';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

export const POST: RequestHandler = async ({ request, url, platform }) => {
	if (!platform) return json({ error: 'platform unavailable' }, { status: 500 });
	const submissionId = url.searchParams.get('submission') ?? '';
	const deviceId = url.searchParams.get('device') ?? '';
	if (!submissionId || !deviceId) return json({ error: 'missing submission/device' }, { status: 400 });

	const contentType = request.headers.get('content-type') ?? '';
	const ext = TYPES[contentType];
	if (!ext) return json({ error: 'unsupported content-type' }, { status: 400 });

	const body = await request.arrayBuffer();
	if (body.byteLength === 0 || body.byteLength > MAX_BYTES)
		return json({ error: 'photo must be 1 byte – 5 MiB' }, { status: 413 });

	const photoKey = `photos/${submissionId}.${ext}`;
	// Verify ownership BEFORE writing to R2 so strangers can't attach photos.
	const owned = await attachPhoto(platform.env.DB, submissionId, deviceId, photoKey);
	if (!owned) return json({ error: 'unknown submission for this device' }, { status: 403 });
	await platform.env.BUCKET.put(photoKey, body, { httpMetadata: { contentType } });
	return json({ ok: true });
};
```

- [ ] **Step 6: Smoke-test the running API against local D1** (vite dev serves real local bindings; migrations were applied in Task 4 Step 7):

```bash
npm run dev &   # or run in a second terminal
sleep 5
SITE=$(node -e "const s=require('./static/data/sites.json').features[0].properties; console.log(s.siteId)")
KEY=$(node -e "const s=require('./static/data/sites.json').features[0].properties; console.log(s.conditions[0].key)")
curl -s -X POST http://localhost:5173/api/submissions -H 'content-type: application/json' \
  -d "{\"deviceId\":\"smoke-test-device\",\"siteId\":\"$SITE\",\"conditionKey\":\"$KEY\",\"verdict\":\"present\"}"
curl -s http://localhost:5173/api/status
```

Expected: first curl → `{"id":"<uuid>"}`; second → `{"conditions":{"<key>":{"present":1,...}}}`. Kill the dev server after.

- [ ] **Step 7: Commit, PR**

```bash
git checkout -b task/5-api-routes
git add src/lib/server/validate.ts src/routes/api tests/unit/validate.test.ts
git commit -m "feat: submissions/status/photos API routes with validation"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 6: Map screen — pins, clustering, status rings

**Files:**
- Create: `src/app.css` (replace scaffold styles), `src/lib/status.ts`, `src/lib/app-state.svelte.ts`, `src/lib/components/MapCanvas.svelte`, `src/routes/(map)/+layout.svelte`, `src/routes/(map)/+layout.ts`, `src/routes/(map)/+page.svelte`
- Move: scaffold's `src/routes/+page.svelte` → delete (replaced by the `(map)` group); keep `src/routes/+layout.svelte` importing `app.css` only
- Test: `tests/unit/status.test.ts`

**Interfaces:**
- Consumes: `SitesCollection` from `/data/sites.json`; types from `$lib/types`.
- Produces: `appState` singleton (`sites: SiteFeature[]`, `statusCounts: Record<string, StatusCounts>`, `userPos: {lat,lng} | null`, `tally: number`); `siteRing(site: SiteProperties, counts: Record<string, StatusCounts>): 'none' | 'present' | 'absent' | 'mixed'`; `buildMapData(sites, counts): GeoJSON` (features with `icon`, `ringColor` properties); `<MapCanvas sites onSelect />` emitting `onSelect(siteId)`. Task 8 navigates on `onSelect`; Task 10 re-feeds `buildMapData` on status refresh.

- [ ] **Step 1: Write failing tests for the pure status math**

```ts
// tests/unit/status.test.ts
import { describe, expect, it } from 'vitest';
import { siteRing, RING_COLORS, dominantType } from '../../src/lib/status';
import type { SiteProperties } from '../../src/lib/types';

const site = (types: string[]): SiteProperties => ({
	siteId: 's',
	address: 'a',
	aicRef: 'r',
	ward: '10',
	status: null,
	appliedYear: null,
	conditions: types.map((t, i) => ({
		key: `k${i}`,
		type: t as SiteProperties['conditions'][0]['type'],
		description: '',
		rawText: '',
		sourceUrl: ''
	}))
});

const counts = (m: Record<string, [number, number, number]>) =>
	Object.fromEntries(
		Object.entries(m).map(([k, [present, absent, unclear]]) => [
			k,
			{ present, absent, unclear, photos: 0 }
		])
	);

describe('siteRing', () => {
	it('is none with no reports', () => {
		expect(siteRing(site(['pavers']), {})).toBe('none');
	});
	it('is present when present outweighs absent across conditions', () => {
		expect(siteRing(site(['pavers', 'landscaping']), counts({ k0: [2, 0, 0], k1: [1, 1, 0] }))).toBe('present');
	});
	it('is absent when absent outweighs present', () => {
		expect(siteRing(site(['pavers']), counts({ k0: [0, 3, 1] }))).toBe('absent');
	});
	it('is mixed on a tie or unclear-only reports', () => {
		expect(siteRing(site(['pavers']), counts({ k0: [1, 1, 0] }))).toBe('mixed');
		expect(siteRing(site(['pavers']), counts({ k0: [0, 0, 2] }))).toBe('mixed');
	});
	it('RING_COLORS covers every ring state', () => {
		for (const s of ['none', 'present', 'absent', 'mixed'] as const)
			expect(RING_COLORS[s]).toMatch(/^#/);
	});
});

describe('dominantType', () => {
	it('picks the most frequent condition type', () => {
		expect(dominantType(site(['bike_parking', 'bike_parking', 'public_art']))).toBe('bike_parking');
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/status.test.ts`
Expected: FAIL — cannot resolve `src/lib/status`.

- [ ] **Step 3: Implement `src/lib/status.ts`**

```ts
import type { SiteProperties, StatusCounts } from '$lib/types';

export type RingState = 'none' | 'present' | 'absent' | 'mixed';

export const RING_COLORS: Record<RingState, string> = {
	none: '#94a3b8',
	present: '#16a34a',
	absent: '#dc2626',
	mixed: '#d97706'
};

export function siteRing(
	site: SiteProperties,
	counts: Record<string, StatusCounts>
): RingState {
	let present = 0;
	let absent = 0;
	let any = 0;
	for (const c of site.conditions) {
		const s = counts[c.key];
		if (!s) continue;
		present += s.present;
		absent += s.absent;
		any += s.present + s.absent + s.unclear;
	}
	if (any === 0) return 'none';
	if (present > absent) return 'present';
	if (absent > present) return 'absent';
	return 'mixed';
}

export function dominantType(site: SiteProperties): SiteProperties['conditions'][0]['type'] {
	const tally = new Map<string, number>();
	for (const c of site.conditions) tally.set(c.type, (tally.get(c.type) ?? 0) + 1);
	let best = site.conditions[0].type;
	let n = 0;
	for (const [t, count] of tally) if (count > n) ((best = t as typeof best), (n = count));
	return best;
}
```

- [ ] **Step 4: Run to verify pass**, then implement the visual layer. `npm test` → PASS. Then:

`src/lib/app-state.svelte.ts` (a runes-based singleton — import anywhere):

```ts
import type { SiteFeature, StatusCounts } from '$lib/types';

class AppState {
	sites = $state<SiteFeature[]>([]);
	statusCounts = $state<Record<string, StatusCounts>>({});
	userPos = $state<{ lat: number; lng: number; accuracyM: number } | null>(null);
	tally = $state(0); // verdicts sent this session
	pendingSync = $state(0); // queued submissions awaiting network
}

export const appState = new AppState();
```

`src/app.css` (design tokens + base; replace scaffold css):

```css
:root {
	--bg: #f8fafc;
	--surface: #ffffff;
	--ink: #0f172a;
	--ink-soft: #475569;
	--brand: #0f766e;
	--present: #16a34a;
	--absent: #dc2626;
	--unclear: #d97706;
	--radius: 14px;
	--shadow: 0 8px 30px rgb(15 23 42 / 0.14);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
	font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	color: var(--ink);
	background: var(--bg);
	overscroll-behavior: none;
}
button { font: inherit; }
```

`src/lib/components/MapCanvas.svelte` — the type emoji live in canvas-rasterized images (symbol-layer glyph fonts can't render emoji):

```svelte
<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { onMount } from 'svelte';
	import type { SiteFeature } from '$lib/types';
	import { appState } from '$lib/app-state.svelte';
	import { RING_COLORS, dominantType, siteRing } from '$lib/status';

	let {
		onSelect,
		registerMap
	}: {
		onSelect: (siteId: string) => void;
		registerMap?: (map: maplibregl.Map, geolocate: maplibregl.GeolocateControl) => void;
	} = $props();

	let container: HTMLDivElement;
	let mapRef: maplibregl.Map | undefined;
	let sourceReady = $state(false);

	// Status or sites changed → refresh source data (90 features: trivially cheap).
	// Top-level $effect — effects CANNOT be created inside onMount callbacks
	// (effect_orphan). This one no-ops until the source exists.
	$effect(() => {
		const data = buildMapData(appState.sites, appState.statusCounts);
		if (sourceReady) (mapRef?.getSource('sites') as maplibregl.GeoJSONSource | undefined)?.setData(data);
	});

	export function buildMapData(sites: SiteFeature[], counts: typeof appState.statusCounts) {
		return {
			type: 'FeatureCollection' as const,
			features: sites.map((f) => ({
				...f,
				properties: {
					siteId: f.properties.siteId,
					icon: `icon-${dominantType(f.properties)}`,
					ringColor: RING_COLORS[siteRing(f.properties, counts)],
					nConditions: f.properties.conditions.length
				}
			}))
		};
	}

	const TYPE_EMOJI: Record<string, string> = {
		landscaping: '🌳',
		bike_parking: '🚲',
		public_art: '🎨',
		street_furniture: '🪑',
		pavers: '🧱'
	};

	function emojiIcon(emoji: string, size = 64): ImageData {
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const ctx = c.getContext('2d')!;
		ctx.font = `${Math.round(size * 0.72)}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
		return ctx.getImageData(0, 0, size, size);
	}

	onMount(() => {
		const map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/bright',
			center: [-79.39, 43.645],
			zoom: 13,
			attributionControl: { compact: true } // OpenFreeMap/OSM attribution comes from the style — required, do not remove
		});

		const geolocate = new maplibregl.GeolocateControl({
			positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
			trackUserLocation: true,
			showUserLocation: true,
			showAccuracyCircle: true,
			fitBoundsOptions: { maxZoom: 16 }
		});
		map.addControl(geolocate); // hidden via CSS; triggered from our FAB
		geolocate.on('geolocate', (pos) => {
			appState.userPos = {
				lat: pos.coords.latitude,
				lng: pos.coords.longitude,
				accuracyM: pos.coords.accuracy
			};
		});

		mapRef = map;

		map.on('load', () => {
			for (const [type, emoji] of Object.entries(TYPE_EMOJI)) {
				map.addImage(`icon-${type}`, emojiIcon(emoji), { pixelRatio: 2 });
			}

			map.addSource('sites', {
				type: 'geojson',
				data: buildMapData(appState.sites, appState.statusCounts),
				cluster: true,
				clusterMaxZoom: 15,
				clusterRadius: 55,
				promoteId: 'siteId'
			});

			map.addLayer({
				id: 'clusters',
				type: 'circle',
				source: 'sites',
				filter: ['has', 'point_count'],
				paint: {
					'circle-color': '#0f766e',
					'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24],
					'circle-stroke-width': 3,
					'circle-stroke-color': '#ffffff'
				}
			});
			map.addLayer({
				id: 'cluster-count',
				type: 'symbol',
				source: 'sites',
				filter: ['has', 'point_count'],
				layout: {
					'text-field': ['get', 'point_count_abbreviated'],
					'text-font': ['Noto Sans Regular'],
					'text-size': 13
				},
				paint: { 'text-color': '#ffffff' }
			});
			// Status ring under the icon — the map accumulates the evening's story.
			map.addLayer({
				id: 'site-rings',
				type: 'circle',
				source: 'sites',
				filter: ['!', ['has', 'point_count']],
				paint: {
					'circle-color': ['get', 'ringColor'],
					'circle-radius': 15,
					'circle-opacity': 0.95,
					'circle-stroke-width': 2.5,
					'circle-stroke-color': '#ffffff'
				}
			});
			map.addLayer({
				id: 'site-icons',
				type: 'symbol',
				source: 'sites',
				filter: ['!', ['has', 'point_count']],
				layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.42, 'icon-allow-overlap': true }
			});
			// Spec: multi-condition sites get a count badge.
			map.addLayer({
				id: 'site-count',
				type: 'symbol',
				source: 'sites',
				filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'nConditions'], 1]],
				layout: {
					'text-field': ['to-string', ['get', 'nConditions']],
					'text-font': ['Noto Sans Bold'],
					'text-size': 11,
					'text-offset': [1.1, -1.1],
					'text-allow-overlap': true
				},
				paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
			});

			map.on('click', 'clusters', async (e) => {
				const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
				const source = map.getSource('sites') as maplibregl.GeoJSONSource;
				const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
				map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
			});
			map.on('click', ['site-rings', 'site-icons'], (e) => {
				const f = e.features?.[0];
				if (f) onSelect(String(f.properties.siteId));
			});
			for (const layer of ['clusters', 'site-rings', 'site-icons']) {
				map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
				map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
			}

			sourceReady = true;
			registerMap?.(map, geolocate);
		});

		return () => map.remove();
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		position: fixed;
		inset: 0;
	}
	/* We trigger geolocation from our own FAB */
	:global(.maplibregl-ctrl-geolocate) {
		display: none;
	}
</style>
```

`src/routes/+layout.svelte` (root — css only):

```svelte
<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
```

`src/routes/(map)/+layout.ts` (universal load — SSR + client both fetch the static asset):

```ts
import type { LayoutLoad } from './$types';
import type { SitesCollection } from '$lib/types';

export const load: LayoutLoad = async ({ fetch }) => {
	const res = await fetch('/data/sites.json');
	const sites: SitesCollection = await res.json();
	return { sites };
};
```

`src/routes/(map)/+layout.svelte` (map persists across `/` ↔ `/site/x` navigations — never remounts):

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import MapCanvas from '$lib/components/MapCanvas.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data, children } = $props();
	$effect.pre(() => {
		appState.sites = data.sites.features;
	});
</script>

<svelte:head>
	<title>Did They Build It?</title>
	<meta name="description" content="Check whether Toronto developers actually built what their approvals promised." />
</svelte:head>

<MapCanvas onSelect={(siteId) => goto(`/site/${siteId}`)} />

<header class="brand">Did They Build It?</header>

{@render children()}

<style>
	.brand {
		position: fixed;
		top: 12px;
		left: 12px;
		background: var(--surface);
		padding: 8px 14px;
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		font-weight: 700;
	}
</style>
```

`src/routes/(map)/+page.svelte`:

```svelte
<!-- Home: the map alone. The site sheet is the /site/[siteId] child route. -->
```

Delete the scaffold's `src/routes/+page.svelte` (replaced by the group route).

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, open http://localhost:5173.
Expected: full-screen vector map of downtown Toronto, ~20 pins with emoji icons on grey rings (no reports yet), clusters where pins are dense; tapping a cluster zooms; tapping a pin navigates to `/site/<siteId>` (404 for now — Task 8 adds the route). Use the browser devtools mobile viewport to sanity-check layout.

- [ ] **Step 6: Commit, PR**

```bash
git checkout -b task/6-map-screen
git add src/ tests/unit/status.test.ts
git commit -m "feat: MapLibre map with clustered emoji pins and status rings"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 7: "Near me" + nearby list

**Files:**
- Create: `src/lib/geo.ts`, `src/lib/components/NearbyList.svelte`
- Modify: `src/routes/(map)/+layout.svelte` (FAB, list button, wiring)
- Test: `tests/unit/geo.test.ts`

**Interfaces:**
- Consumes: `appState.userPos` (set by MapCanvas's geolocate handler), `registerMap` (Task 6).
- Produces: `haversineM(a: {lat,lng}, b: {lat,lng}): number`; `formatDistance(m: number): string` ("120 m" / "1.4 km"); `sortByDistance(sites: SiteFeature[], origin: {lat,lng}): Array<{ site: SiteFeature; distanceM: number }>`; `<NearbyList open origin onSelect onClose />`.

- [ ] **Step 1: Write failing geo tests**

```ts
// tests/unit/geo.test.ts
import { describe, expect, it } from 'vitest';
import { formatDistance, haversineM, sortByDistance } from '../../src/lib/geo';
import type { SiteFeature } from '../../src/lib/types';

const at = (lng: number, lat: number, siteId: string): SiteFeature => ({
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [lng, lat] },
	properties: { siteId, address: '', aicRef: '', ward: '', status: null, appliedYear: null, conditions: [] }
});

describe('haversineM', () => {
	it('CN Tower to Union Station is ~500-700 m', () => {
		const d = haversineM({ lat: 43.6426, lng: -79.3871 }, { lat: 43.6453, lng: -79.3806 });
		expect(d).toBeGreaterThan(400);
		expect(d).toBeLessThan(800);
	});
	it('zero distance to itself', () => {
		expect(haversineM({ lat: 43.6, lng: -79.4 }, { lat: 43.6, lng: -79.4 })).toBe(0);
	});
});

describe('formatDistance', () => {
	it('metres under 1 km, one-decimal km above', () => {
		expect(formatDistance(87)).toBe('87 m');
		expect(formatDistance(1400)).toBe('1.4 km');
	});
});

describe('sortByDistance', () => {
	it('sorts nearest first with distances attached', () => {
		const sites = [at(-79.38, 43.66, 'far'), at(-79.3905, 43.6455, 'near')];
		const sorted = sortByDistance(sites, { lat: 43.645, lng: -79.39 });
		expect(sorted[0].site.properties.siteId).toBe('near');
		expect(sorted[0].distanceM).toBeLessThan(sorted[1].distanceM);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/geo.test.ts`
Expected: FAIL — cannot resolve `src/lib/geo`.

- [ ] **Step 3: Implement `src/lib/geo.ts`**

```ts
import type { SiteFeature } from '$lib/types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export function formatDistance(m: number): string {
	return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export function sortByDistance(
	sites: SiteFeature[],
	origin: { lat: number; lng: number }
): Array<{ site: SiteFeature; distanceM: number }> {
	return sites
		.map((site) => ({
			site,
			distanceM: haversineM(origin, {
				lng: site.geometry.coordinates[0],
				lat: site.geometry.coordinates[1]
			})
		}))
		.sort((a, b) => a.distanceM - b.distanceM);
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Implement `NearbyList.svelte` and wire the FAB.**

```svelte
<!-- src/lib/components/NearbyList.svelte -->
<script lang="ts">
	import { formatDistance, sortByDistance } from '$lib/geo';
	import { appState } from '$lib/app-state.svelte';

	let {
		open = $bindable(false),
		origin,
		onSelect
	}: {
		open: boolean;
		origin: { lat: number; lng: number };
		onSelect: (siteId: string) => void;
	} = $props();

	const TYPE_EMOJI: Record<string, string> = {
		landscaping: '🌳',
		bike_parking: '🚲',
		public_art: '🎨',
		street_furniture: '🪑',
		pavers: '🧱'
	};

	let sorted = $derived(sortByDistance(appState.sites, origin).slice(0, 30));
</script>

{#if open}
	<div class="scrim" onclick={() => (open = false)} role="presentation"></div>
	<section class="sheet" aria-label="Nearby sites">
		<div class="grab"></div>
		<h2>Nearby promises</h2>
		<ul>
			{#each sorted as { site, distanceM } (site.properties.siteId)}
				{@const p = site.properties}
				<li>
					<button onclick={() => { open = false; onSelect(p.siteId); }}>
						<span class="dist">{formatDistance(distanceM)}</span>
						<span class="addr">{p.address}</span>
						<span class="types">
							{TYPE_EMOJI[p.conditions[0].type]}
							{#if p.conditions.length > 1}+{p.conditions.length - 1} more{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.scrim { position: fixed; inset: 0; background: rgb(15 23 42 / 0.25); }
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		max-height: 70dvh;
		overflow-y: auto;
		background: var(--surface);
		border-radius: var(--radius) var(--radius) 0 0;
		box-shadow: var(--shadow);
		padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
		animation: rise 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
	@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
	.grab { width: 40px; height: 4px; border-radius: 2px; background: #cbd5e1; margin: 4px auto 10px; }
	h2 { font-size: 1rem; margin: 0 0 8px; color: var(--ink-soft); }
	ul { list-style: none; margin: 0; padding: 0; }
	li button {
		display: grid;
		grid-template-columns: 4.5rem 1fr auto;
		gap: 10px;
		align-items: center;
		width: 100%;
		padding: 12px 4px;
		background: none;
		border: 0;
		border-bottom: 1px solid #e2e8f0;
		text-align: left;
		cursor: pointer;
	}
	.dist { color: var(--brand); font-weight: 700; font-variant-numeric: tabular-nums; }
	.addr { font-weight: 600; }
	.types { color: var(--ink-soft); font-size: 0.85rem; }
</style>
```

In `src/routes/(map)/+layout.svelte`, extend the script and markup (keep everything from Task 6; additions shown in full):

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import type maplibregl from 'maplibre-gl';
	import MapCanvas from '$lib/components/MapCanvas.svelte';
	import NearbyList from '$lib/components/NearbyList.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data, children } = $props();
	$effect.pre(() => {
		appState.sites = data.sites.features;
	});

	let geolocate: maplibregl.GeolocateControl | undefined;
	let listOpen = $state(false);
	// map.getCenter() is not reactive — mirror it into $state on moveend so the
	// fallback origin tracks where the user panned to.
	let mapCenter = $state({ lat: 43.645, lng: -79.39 });

	// Geolocation fallback: sort from map centre when we don't have a fix.
	let origin = $derived(appState.userPos ?? mapCenter);

	function nearMe() {
		const ok = geolocate?.trigger() ?? false;
		listOpen = true; // open regardless — falls back to distance-from-map-centre
		if (!ok) console.warn('geolocate control not ready');
	}
</script>

<MapCanvas
	onSelect={(siteId) => goto(`/site/${siteId}`)}
	registerMap={(m, g) => {
		geolocate = g;
		m.on('moveend', () => {
			const c = m.getCenter();
			mapCenter = { lat: c.lat, lng: c.lng };
		});
		g.on('geolocate', () => (listOpen = true));
		g.on('error', () => (listOpen = true)); // denied/unavailable → list still works
	}}
/>

<header class="brand">Did They Build It?</header>
<button class="list-toggle" onclick={() => (listOpen = !listOpen)} aria-label="List of nearby sites">☰ List</button>
<button class="fab" onclick={nearMe}>📍 Near me</button>

<NearbyList bind:open={listOpen} {origin} onSelect={(siteId) => goto(`/site/${siteId}`)} />

{@render children()}

<style>
	.brand { position: fixed; top: 12px; left: 12px; background: var(--surface); padding: 8px 14px; border-radius: var(--radius); box-shadow: var(--shadow); font-weight: 700; }
	.list-toggle { position: fixed; top: 12px; right: 12px; background: var(--surface); border: 0; padding: 8px 14px; border-radius: var(--radius); box-shadow: var(--shadow); cursor: pointer; }
	.fab {
		position: fixed;
		right: 16px;
		bottom: calc(24px + env(safe-area-inset-bottom));
		background: var(--brand);
		color: #fff;
		border: 0;
		border-radius: 999px;
		padding: 16px 22px;
		font-size: 1.05rem;
		font-weight: 700;
		box-shadow: var(--shadow);
		cursor: pointer;
		transition: transform 120ms ease;
	}
	.fab:active { transform: scale(0.94); }
</style>
```

- [ ] **Step 6: Manually verify.** `npm run dev` → tap "📍 Near me": browser asks for location permission; on grant the map flies to you with a blue dot + accuracy circle and the list opens sorted by distance; on deny the list still opens (sorted from map centre). Distances read like "120 m".

- [ ] **Step 7: Commit, PR**

```bash
git checkout -b task/7-near-me
git add src/ tests/unit/geo.test.ts
git commit -m "feat: geolocation FAB and distance-sorted nearby list"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 8: Site sheet + one-tap verify flow (queue, confetti, tally)

**Files:**
- Create: `src/lib/device.ts`, `src/lib/queue.ts`, `src/lib/confetti.ts`, `src/lib/components/SiteSheet.svelte`, `src/lib/components/ConditionCard.svelte`, `src/lib/components/Toast.svelte`, `src/routes/(map)/site/[siteId]/+page.svelte`, `src/routes/(map)/site/[siteId]/+page.ts`
- Test: `tests/unit/queue.test.ts`

**Interfaces:**
- Consumes: `POST /api/submissions` (Task 5), `appState` (Task 6), types.
- Produces: `deviceId(): string`; `createQueue(deps): { submit(p: SubmissionPayload): Promise<QueueResult>; flush(): Promise<void>; pending(): number }` where `QueueResult = { state: 'sent'; id: string } | { state: 'queued' } | { state: 'rejected' }`; `burst(x: number, y: number): void`. Task 9's photo strip uses the `sent` id; Task 10 refreshes status after `sent`.

- [ ] **Step 1: Write failing queue tests** (injectable storage + post → testable in node):

```ts
// tests/unit/queue.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createQueue, type StorageLike } from '../../src/lib/queue';
import type { SubmissionPayload } from '../../src/lib/types';

const memStorage = (): StorageLike => {
	const m = new Map<string, string>();
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k)
	};
};

const payload: SubmissionPayload = {
	deviceId: 'd',
	siteId: 's',
	conditionKey: 'k',
	verdict: 'present'
};

describe('createQueue', () => {
	it('returns sent with the server id when POST succeeds', async () => {
		const post = vi.fn().mockResolvedValue({ ok: true, id: 'server-id' });
		const q = createQueue({ storage: memStorage(), post });
		expect(await q.submit(payload)).toEqual({ state: 'sent', id: 'server-id' });
		expect(q.pending()).toBe(0);
	});

	it('queues on network failure and reports pending', async () => {
		const post = vi.fn().mockRejectedValue(new Error('offline'));
		const q = createQueue({ storage: memStorage(), post });
		expect(await q.submit(payload)).toEqual({ state: 'queued' });
		expect(q.pending()).toBe(1);
	});

	it('flush drains the queue once the network recovers', async () => {
		const post = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue({ ok: true, id: 'x' });
		const storage = memStorage();
		const q = createQueue({ storage, post });
		await q.submit(payload);
		expect(q.pending()).toBe(1);
		await q.flush();
		expect(q.pending()).toBe(0);
	});

	it('does NOT queue on a 4xx rejection (server said no — retrying cannot help)', async () => {
		const post = vi.fn().mockResolvedValue({ ok: false, status: 400 });
		const q = createQueue({ storage: memStorage(), post });
		expect(await q.submit(payload)).toEqual({ state: 'rejected' });
		expect(q.pending()).toBe(0);
	});

	it('persists the queue across instances (page reloads)', async () => {
		const storage = memStorage();
		const failing = createQueue({ storage, post: vi.fn().mockRejectedValue(new Error('x')) });
		await failing.submit(payload);
		const revived = createQueue({ storage, post: vi.fn().mockResolvedValue({ ok: true, id: 'y' }) });
		expect(revived.pending()).toBe(1);
		await revived.flush();
		expect(revived.pending()).toBe(0);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/queue.test.ts`
Expected: FAIL — cannot resolve `src/lib/queue`.

- [ ] **Step 3: Implement `src/lib/queue.ts` and `src/lib/device.ts`**

```ts
// src/lib/queue.ts
import type { SubmissionPayload } from '$lib/types';

export interface StorageLike {
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}

export type PostResult = { ok: true; id: string } | { ok: false; status: number };
export type QueueResult = { state: 'sent'; id: string } | { state: 'queued' } | { state: 'rejected' };

const KEY = 'dtbi:queue';

export function createQueue(deps: {
	storage: StorageLike;
	post: (p: SubmissionPayload) => Promise<PostResult>;
	onChange?: (pending: number) => void;
}) {
	const read = (): SubmissionPayload[] => JSON.parse(deps.storage.getItem(KEY) ?? '[]');
	const write = (items: SubmissionPayload[]) => {
		deps.storage.setItem(KEY, JSON.stringify(items));
		deps.onChange?.(items.length);
	};

	async function submit(p: SubmissionPayload): Promise<QueueResult> {
		try {
			const res = await deps.post(p);
			if (res.ok) return { state: 'sent', id: res.id };
			return { state: 'rejected' }; // 4xx/5xx response: retrying the same payload won't help
		} catch {
			write([...read(), p]); // network failure: keep it safe, retry later
			return { state: 'queued' };
		}
	}

	async function flush(): Promise<void> {
		const items = read();
		const remaining: SubmissionPayload[] = [];
		for (const p of items) {
			try {
				await deps.post(p); // upsert semantics server-side → retries are idempotent
			} catch {
				remaining.push(p);
			}
		}
		write(remaining);
	}

	return { submit, flush, pending: () => read().length };
}

export function postSubmission(fetchFn: typeof fetch) {
	return async (p: SubmissionPayload): Promise<PostResult> => {
		const res = await fetchFn('/api/submissions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(p)
		});
		if (!res.ok) return { ok: false, status: res.status };
		const { id } = (await res.json()) as { id: string };
		return { ok: true, id };
	};
}
```

```ts
// src/lib/device.ts
const KEY = 'dtbi:device';

export function deviceId(): string {
	let id = localStorage.getItem(KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(KEY, id);
	}
	return id;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS (queue suite included).

- [ ] **Step 5: Implement `src/lib/confetti.ts`** — delta-time physics so it runs identically at 60/120/240 Hz:

```ts
// Delta-time confetti burst. No dependencies, honors prefers-reduced-motion.
const COLORS = ['#0f766e', '#16a34a', '#f59e0b', '#3b82f6', '#ec4899'];

export function burst(x: number, y: number): void {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const canvas = document.createElement('canvas');
	const dpr = Math.min(devicePixelRatio || 1, 2);
	canvas.width = innerWidth * dpr;
	canvas.height = innerHeight * dpr;
	canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
	document.body.appendChild(canvas);
	const ctx = canvas.getContext('2d')!;
	ctx.scale(dpr, dpr);

	const parts = Array.from({ length: 60 }, () => {
		const angle = Math.random() * Math.PI * 2;
		const speed = 220 + Math.random() * 380; // px/s
		return {
			x, y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 260,
			size: 5 + Math.random() * 5,
			color: COLORS[(Math.random() * COLORS.length) | 0],
			spin: (Math.random() - 0.5) * 18,
			rot: Math.random() * Math.PI
		};
	});

	const G = 1500; // px/s²
	const DURATION = 900; // ms
	const start = performance.now();
	let prev = start;

	function frame(now: number) {
		const dt = Math.min((now - prev) / 1000, 0.05); // seconds; clamp tab-switch spikes
		prev = now;
		const t = now - start;
		ctx.clearRect(0, 0, innerWidth, innerHeight);
		const alpha = 1 - t / DURATION;
		for (const p of parts) {
			p.vy += G * dt;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.rot += p.spin * dt;
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(p.rot);
			ctx.globalAlpha = Math.max(alpha, 0);
			ctx.fillStyle = p.color;
			ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
			ctx.restore();
		}
		if (t < DURATION) requestAnimationFrame(frame);
		else canvas.remove();
	}
	requestAnimationFrame(frame);
}
```

- [ ] **Step 6: Implement the sheet route, sheet, cards, toast.**

```ts
// src/routes/(map)/site/[siteId]/+page.ts
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => ({ siteId: params.siteId });
```

```svelte
<!-- src/routes/(map)/site/[siteId]/+page.svelte -->
<script lang="ts">
	import SiteSheet from '$lib/components/SiteSheet.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data } = $props();
	let site = $derived(appState.sites.find((f) => f.properties.siteId === data.siteId));
</script>

<SiteSheet {site} />
```

```svelte
<!-- src/lib/components/SiteSheet.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import ConditionCard from '$lib/components/ConditionCard.svelte';
	import type { SiteFeature } from '$lib/types';

	let { site }: { site: SiteFeature | undefined } = $props();
	const close = () => goto('/', { noScroll: true, keepFocus: true });
</script>

<div class="scrim" onclick={close} role="presentation"></div>
<section class="sheet" aria-label="Site details">
	<div class="grab"></div>
	{#if !site}
		<h2>Site not found</h2>
		<p>This link doesn't match a site in the current dataset.</p>
		<button class="back" onclick={close}>← Back to the map</button>
	{:else}
		{@const p = site.properties}
		<header>
			<h2>{p.address}</h2>
			<p class="meta">
				{#if p.appliedYear}Applied {p.appliedYear}{/if}
				{#if p.status} · {p.status}{/if}
				· Ward {p.ward}
			</p>
		</header>
		<p class="promise">The developer agreed to build:</p>
		{#each p.conditions as condition (condition.key)}
			<ConditionCard {condition} siteId={p.siteId} />
		{/each}
	{/if}
</section>

<style>
	.scrim { position: fixed; inset: 0; background: rgb(15 23 42 / 0.25); }
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		max-height: 82dvh;
		overflow-y: auto;
		background: var(--bg);
		border-radius: var(--radius) var(--radius) 0 0;
		box-shadow: var(--shadow);
		padding: 8px 16px calc(20px + env(safe-area-inset-bottom));
		animation: rise 240ms cubic-bezier(0.2, 0.9, 0.3, 1); /* transform-only: compositor */
	}
	@keyframes rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
	@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
	.grab { width: 40px; height: 4px; border-radius: 2px; background: #cbd5e1; margin: 4px auto 10px; }
	h2 { margin: 0; font-size: 1.3rem; }
	.meta { color: var(--ink-soft); margin: 4px 0 0; font-size: 0.9rem; }
	.promise { font-weight: 700; margin: 16px 0 8px; }
	.back { background: var(--brand); color: #fff; border: 0; border-radius: var(--radius); padding: 12px 18px; }
</style>
```

```svelte
<!-- src/lib/components/ConditionCard.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import { burst } from '$lib/confetti';
	import { deviceId } from '$lib/device';
	import { createQueue, postSubmission } from '$lib/queue';
	import { appState } from '$lib/app-state.svelte';
	import type { SiteCondition, Verdict } from '$lib/types';

	let { condition, siteId }: { condition: SiteCondition; siteId: string } = $props();

	const TYPE_LABEL: Record<string, string> = {
		landscaping: '🌳 Landscaping',
		bike_parking: '🚲 Bike parking',
		public_art: '🎨 Public art',
		street_furniture: '🪑 Street furniture',
		pavers: '🧱 Pavers'
	};

	// localStorage doesn't exist during SSR (the /site/[siteId] deep link renders
	// server-side) — build the queue lazily inside event handlers, which are
	// browser-only, and guard the initial read with `browser`.
	let _queue: ReturnType<typeof createQueue> | undefined;
	const queue = () =>
		(_queue ??= createQueue({
			storage: localStorage,
			post: postSubmission(fetch),
			onChange: (n) => (appState.pendingSync = n)
		}));

	// idle → sending → sent | queued; myVerdict persists per device via localStorage
	let myVerdict = $state<Verdict | null>(
		browser ? ((localStorage.getItem(`dtbi:v:${condition.key}`) as Verdict | null) ?? null) : null
	);
	let sentId = $state<string | null>(null);
	let showRaw = $state(false);

	let counts = $derived(appState.statusCounts[condition.key]);

	async function tap(verdict: Verdict, e: MouseEvent) {
		const isUpdate = myVerdict !== null;
		myVerdict = verdict; // optimistic: < 50 ms acknowledgment
		localStorage.setItem(`dtbi:v:${condition.key}`, verdict);
		navigator.vibrate?.(15);
		if (!isUpdate) {
			burst(e.clientX, e.clientY);
			appState.tally += 1;
		}
		const result = await queue().submit({
			deviceId: deviceId(),
			siteId,
			conditionKey: condition.key,
			verdict,
			lat: appState.userPos?.lat ?? null,
			lng: appState.userPos?.lng ?? null,
			accuracyM: appState.userPos?.accuracyM ?? null
		});
		if (result.state === 'sent') sentId = result.id;
	}
</script>

<article class="card">
	<p class="type">{TYPE_LABEL[condition.type]}</p>
	<p class="desc">{condition.description}</p>
	<button class="raw-toggle" onclick={() => (showRaw = !showRaw)}>
		{showRaw ? 'Hide' : 'Show'} exact wording
	</button>
	{#if showRaw}
		<blockquote>{condition.rawText} <a href={condition.sourceUrl} target="_blank" rel="noopener">source ↗</a></blockquote>
	{/if}

	<div class="verdicts" role="group" aria-label="Is it there?">
		<button class="v present" class:active={myVerdict === 'present'} onclick={(e) => tap('present', e)}>✓ It's there</button>
		<button class="v absent" class:active={myVerdict === 'absent'} onclick={(e) => tap('absent', e)}>✗ Not there</button>
		<button class="v unclear" class:active={myVerdict === 'unclear'} onclick={(e) => tap('unclear', e)}>🤷 Can't tell</button>
	</div>

	{#if myVerdict}
		<p class="thanks">
			Recorded — thank you!
			{#if appState.pendingSync > 0}<span class="sync">{appState.pendingSync} report{appState.pendingSync > 1 ? 's' : ''} syncing…</span>{/if}
		</p>
	{/if}

	{#if counts && counts.present + counts.absent + counts.unclear > 0}
		<p class="community">
			{counts.present} say it's there · {counts.absent} say missing
			{#if counts.photos > 0} · 📷 {counts.photos}{/if}
		</p>
	{/if}
</article>

<style>
	.card { background: var(--surface); border-radius: var(--radius); box-shadow: 0 2px 10px rgb(15 23 42 / 0.07); padding: 14px; margin-bottom: 12px; }
	.type { font-weight: 700; margin: 0 0 6px; }
	.desc { margin: 0 0 8px; }
	.raw-toggle { background: none; border: 0; color: var(--brand); padding: 0; font-size: 0.85rem; cursor: pointer; }
	blockquote { font-size: 0.85rem; color: var(--ink-soft); border-left: 3px solid #e2e8f0; margin: 8px 0; padding-left: 10px; }
	.verdicts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px; }
	.v {
		border: 2px solid #e2e8f0;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 12px 4px;
		font-weight: 700;
		cursor: pointer;
		transition: transform 100ms ease, border-color 100ms ease;
	}
	.v:active { transform: scale(0.95); }
	.v.present.active { border-color: var(--present); background: #f0fdf4; }
	.v.absent.active { border-color: var(--absent); background: #fef2f2; }
	.v.unclear.active { border-color: var(--unclear); background: #fffbeb; }
	.thanks { color: var(--present); font-weight: 600; margin: 10px 0 0; }
	.sync { color: var(--unclear); font-weight: 400; font-size: 0.85rem; margin-left: 6px; }
	.community { color: var(--ink-soft); font-size: 0.85rem; margin: 6px 0 0; }
</style>
```

```svelte
<!-- src/lib/components/Toast.svelte -->
<script lang="ts">
	import { appState } from '$lib/app-state.svelte';

	let visible = $state(false);
	let timer: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (appState.tally > 0) {
			visible = true;
			clearTimeout(timer);
			timer = setTimeout(() => (visible = false), 2500);
		}
	});
</script>

{#if visible}
	<div class="toast" role="status">
		{appState.tally} promise{appState.tally > 1 ? 's' : ''} checked tonight 🎉
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--ink);
		color: #fff;
		padding: 10px 18px;
		border-radius: 999px;
		box-shadow: var(--shadow);
		animation: pop 200ms ease;
		z-index: 50;
	}
	@keyframes pop { from { transform: translateX(-50%) scale(0.8); opacity: 0; } }
</style>
```

Add to `src/routes/(map)/+layout.svelte`: import `Toast` and `createQueue`/`postSubmission`; render `<Toast />` after the FAB; and flush the queue on load + on reconnect (inside the existing `<script>`):

```ts
	import { onMount } from 'svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { createQueue, postSubmission } from '$lib/queue';

	onMount(() => {
		const queue = createQueue({
			storage: localStorage,
			post: postSubmission(fetch),
			onChange: (n) => (appState.pendingSync = n)
		});
		appState.pendingSync = queue.pending();
		queue.flush();
		const onOnline = () => queue.flush();
		addEventListener('online', onOnline);
		const interval = setInterval(() => queue.pending() > 0 && queue.flush(), 15000);
		return () => {
			removeEventListener('online', onOnline);
			clearInterval(interval);
		};
	});
```

- [ ] **Step 7: Manually verify the full loop.** `npm run dev` (mobile viewport): tap a pin → sheet slides up over the map with address, "Applied YYYY · Status", condition cards. Tap "✓ It's there" → instant highlight + confetti + "Recorded — thank you!"; browser back button closes the sheet; reopening shows your verdict still selected; tapping a different verdict updates it (no second confetti). DevTools → Network → Offline: tap a verdict → "1 report syncing…" appears; back online → it clears within 15 s. Direct-load a deep link — get a real id with `node -e "console.log(require('./static/data/sites.json').features[0].properties.siteId)"` and open `http://localhost:5173/site/<that-id>` — the sheet renders open with no SSR errors in the terminal. Check D1: `npx wrangler d1 execute did-they-build-it-db --local --command "SELECT verdict, COUNT(*) FROM submissions GROUP BY 1"`.

- [ ] **Step 8: Commit, PR**

```bash
git checkout -b task/8-verify-flow
git add src/ tests/unit/queue.test.ts
git commit -m "feat: site sheet with one-tap verify, offline queue, confetti, tally"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 9: Optional photo + note strip

**Files:**
- Create: `src/lib/photo.ts`
- Modify: `src/lib/components/ConditionCard.svelte`

**Interfaces:**
- Consumes: `POST /api/photos?submission=<id>&device=<id>` (Task 5); `sentId` state (Task 8).
- Produces: `downscale(file: File, maxDim?: number, quality?: number): Promise<Blob>`.

- [ ] **Step 1: Implement `src/lib/photo.ts`** (no unit test — canvas APIs don't exist in the node test env; verified manually in Step 3):

```ts
// Downscale a camera photo to ≤ maxDim px JPEG before upload (fast on LTE).
export async function downscale(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
	);
}
```

- [ ] **Step 2: Add the optional strip to `ConditionCard.svelte`.** In the script, add:

```ts
	import { downscale } from '$lib/photo';

	let photoState = $state<'idle' | 'uploading' | 'done' | 'failed'>('idle');
	let note = $state('');
	let noteState = $state<'idle' | 'saved'>('idle');

	async function addPhoto(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file || !sentId) return;
		photoState = 'uploading';
		try {
			const blob = await downscale(file);
			const res = await fetch(
				`/api/photos?submission=${sentId}&device=${deviceId()}`,
				{ method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob }
			);
			photoState = res.ok ? 'done' : 'failed';
		} catch {
			photoState = 'failed'; // verdict already stands — photo failure is non-fatal
		}
	}

	async function saveNote() {
		if (!note.trim() || !myVerdict) return;
		// Re-submit with the note; the server upserts (same device+condition).
		await queue().submit({
			deviceId: deviceId(),
			siteId,
			conditionKey: condition.key,
			verdict: myVerdict,
			note: note.trim().slice(0, 500),
			lat: appState.userPos?.lat ?? null,
			lng: appState.userPos?.lng ?? null,
			accuracyM: appState.userPos?.accuracyM ?? null
		});
		noteState = 'saved';
	}
```

In the markup, after the `.thanks` paragraph (photo needs a synced submission id, so it renders once `sentId` is set; the note upserts via the queue so it works even offline):

```svelte
	{#if myVerdict}
		<div class="extras">
			<span class="extras-label">Add a photo or note? (optional)</span>
			<div class="extras-row">
				{#if sentId}
					<label class="photo-btn" class:done={photoState === 'done'}>
						{#if photoState === 'idle'}📷 Photo{:else if photoState === 'uploading'}Uploading…{:else if photoState === 'done'}📷 Added ✓{:else}Retry 📷{/if}
						<input type="file" accept="image/*" capture="environment" onchange={addPhoto} hidden />
					</label>
				{/if}
				<input class="note" type="text" maxlength="500" placeholder="One-line note…" bind:value={note} onblur={saveNote} />
				{#if noteState === 'saved'}<span class="note-ok">✓</span>{/if}
			</div>
		</div>
	{/if}
```

And in the style block:

```css
	.extras { margin-top: 10px; border-top: 1px dashed #e2e8f0; padding-top: 10px; }
	.extras-label { font-size: 0.8rem; color: var(--ink-soft); }
	.extras-row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
	.photo-btn { background: var(--surface); border: 2px solid #e2e8f0; border-radius: var(--radius); padding: 10px 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
	.photo-btn.done { border-color: var(--present); }
	.note { flex: 1; border: 2px solid #e2e8f0; border-radius: var(--radius); padding: 10px 12px; min-width: 0; }
	.note-ok { color: var(--present); font-weight: 700; }
```

- [ ] **Step 3: Manually verify.** In dev on a phone-sized viewport: submit a verdict → strip appears; pick an image → "Uploading…" → "📷 Added ✓". Verify in local R2 and D1:

```bash
npx wrangler d1 execute did-they-build-it-db --local --command "SELECT id, photo_key, note FROM submissions WHERE photo_key IS NOT NULL OR note IS NOT NULL"
```

Expected: the photo_key `photos/<submission-id>.jpg` and your note text. Type a note, tap away → "✓".

- [ ] **Step 4: Commit, PR**

```bash
git checkout -b task/9-photos-notes
git add src/lib/photo.ts src/lib/components/ConditionCard.svelte
git commit -m "feat: optional photo upload (client downscale) and note on verdicts"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 10: Live status merge (community counts + pin rings)

**Files:**
- Modify: `src/routes/(map)/+layout.svelte` (fetch + poll status), `src/lib/queue.ts` (refresh hook)

**Interfaces:**
- Consumes: `GET /api/status` (Task 5); `appState.statusCounts` (Task 6 — MapCanvas's `$effect` already re-renders rings when it changes; ConditionCard already renders counts).

- [ ] **Step 1: Wire status fetching into the map layout's `onMount`** (add to the existing block from Task 8):

```ts
	async function refreshStatus() {
		try {
			const res = await fetch('/api/status');
			if (res.ok) {
				const { conditions } = (await res.json()) as { conditions: typeof appState.statusCounts };
				appState.statusCounts = conditions;
			}
		} catch {
			// non-fatal: status is a progressive enhancement over static data
		}
	}
	refreshStatus();
	const statusInterval = setInterval(refreshStatus, 30000); // live-ish demo counts
	// include clearInterval(statusInterval) in the onMount cleanup return
```

- [ ] **Step 2: Refresh after a successful submit** so your own report shows up immediately. In `createQueue` calls in BOTH the layout and `ConditionCard`, this is already centralized: add an optional `onSent` dep to `createQueue` (`deps.onSent?.()` right after a successful `post` in `submit()` and after each successful flush item), and pass `onSent: refreshStatus` from the layout's queue only. Update `tests/unit/queue.test.ts` with one more test:

```ts
	it('calls onSent after a successful submit and flush', async () => {
		const onSent = vi.fn();
		const post = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ ok: true, id: 'i' });
		const q = createQueue({ storage: memStorage(), post, onSent });
		await q.submit(payload); // queued — no onSent
		expect(onSent).not.toHaveBeenCalled();
		await q.flush();
		expect(onSent).toHaveBeenCalledTimes(1);
	});
```

Run `npx vitest run tests/unit/queue.test.ts` → FAIL (unknown dep) → implement → PASS. Note: `ConditionCard` builds its own queue instance for submits; pass `onSent: () => document.dispatchEvent(new CustomEvent('dtbi:sent'))` there, and in the layout listen: `document.addEventListener('dtbi:sent', refreshStatus)` (cleanup in the return). This keeps the card decoupled from the layout.

- [ ] **Step 3: Manually verify the loop closes.** Two browser windows (one normal, one private = different device IDs): submit "✓ It's there" in one → within a moment the OTHER window's card shows "1 say it's there" (after its 30 s poll or a reload), and the pin's ring turns green. Submit "✗ Not there" from the second window → ring turns amber (tie). This is the demo's magic moment — make sure it works.

- [ ] **Step 4: Commit, PR**

```bash
git checkout -b task/10-status-merge
git add src/ tests/unit/queue.test.ts
git commit -m "feat: live community status on cards and pin rings"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 11: QR page, favicon, meta polish

**Files:**
- Create: `src/routes/qr/+page.svelte`, `static/favicon.svg` (replace scaffold favicon references)
- Modify: `src/app.html` (theme-color, favicon link)

**Interfaces:**
- Consumes: `qrcode` npm package (installed Task 1). Route-level code-splitting keeps it off the map bundle.

- [ ] **Step 1: Implement `/qr`** (a printable hand-out page — big QR + URL):

```svelte
<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let canvas: HTMLCanvasElement;
	let url = $state('');

	onMount(async () => {
		url = location.origin;
		await QRCode.toCanvas(canvas, url, { width: 480, margin: 2 });
	});
</script>

<svelte:head><title>Did They Build It? — QR</title></svelte:head>

<main>
	<h1>Did They Build It?</h1>
	<p>Toronto developers made promises. Help check them.</p>
	<canvas bind:this={canvas}></canvas>
	<p class="url">{url}</p>
</main>

<style>
	main { min-height: 100dvh; display: grid; place-content: center; text-align: center; gap: 12px; padding: 24px; }
	h1 { margin: 0; }
	canvas { margin: 0 auto; max-width: 100%; }
	.url { font-size: 1.3rem; font-weight: 700; color: var(--brand); }
	@media print { .url { color: #000; } }
</style>
```

- [ ] **Step 2: Favicon + meta.** Create `static/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">🏗️</text></svg>
```

In `src/app.html` `<head>`, replace the scaffold favicon line and add theme color:

```html
		<link rel="icon" href="%sveltekit.assets%/favicon.svg" type="image/svg+xml" />
		<meta name="theme-color" content="#0f766e" />
```

(Remove the scaffold's `favicon.png`/other favicon assets if present.)

- [ ] **Step 3: Verify.** `npm run dev` → `/qr` shows a scannable code (scan it with a real phone — it should open your dev URL; on the deployed app it encodes the prod URL automatically since it uses `location.origin`). Browser tab shows the 🏗️ favicon.

- [ ] **Step 4: Commit, PR**

```bash
git checkout -b task/11-qr-polish
git add src/ static/
git commit -m "feat: printable QR page, favicon, meta polish"
npm test && npm run test:workers && npm run build && npm run check:size
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
```

---

### Task 12: Provision Cloudflare, first deploy, field smoke test

**Files:**
- Modify: `wrangler.jsonc` (real `database_id`), `README.md` (create)

USER-INTERACTIVE: this task needs the user for `wrangler login` and creating the API token. Ask them to run the marked commands with the `!` prefix in the session.

- [ ] **Step 1: Authenticate wrangler** — ask the user to run: `! npx wrangler login` (opens browser OAuth; free account signup if needed).

- [ ] **Step 2: Provision D1 + R2**

```bash
npx wrangler d1 create did-they-build-it-db     # prints database_id
npx wrangler r2 bucket create did-they-build-it-photos
```

Paste the printed `database_id` into `wrangler.jsonc` (replacing the zeros placeholder), then `npm run gen`.

- [ ] **Step 3: Set deploy secrets** — CLOUDFLARE_API_TOKEN: user creates at dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers" template + add Account · D1 · Edit permission. CLOUDFLARE_ACCOUNT_ID: `npx wrangler whoami`. Then (each prompts for the value — nothing lands in shell history):

```bash
gh secret set CLOUDFLARE_API_TOKEN --app actions
gh secret set CLOUDFLARE_ACCOUNT_ID --app actions
gh secret list --app actions
```

- [ ] **Step 4: Ship it via the normal gate**

```bash
git checkout -b task/12-deploy
git add wrangler.jsonc README.md
git commit -m "chore: real D1 database id + README; first production deploy"
git push -u origin HEAD && gh pr create --fill && gh pr merge --auto --squash
gh pr checks --watch
gh run list --workflow=deploy.yml --limit 1   # note the run ID after merge
gh run watch <RUN_ID> --exit-status
```

Expected: Deploy workflow green; it prints the live URL `https://did-they-build-it.<account-subdomain>.workers.dev`.

Write `README.md` first (part of this PR): what the app is, `npm run dev` quickstart, `npm run etl` data refresh (needs `../aic-database/data/aic.db`), deploy-on-merge note, spec/plan pointers.

- [ ] **Step 5: Production smoke test (on a real phone, on cellular — not wifi)**
  - Load the workers.dev URL: map interactive in well under 3 s; pins render.
  - "Near me" → permission prompt → blue dot (downtown Toronto or wherever you are; if far from ward 10, the nearby list shows honest multi-km distances — expected).
  - Submit a verdict on a real site → confetti, then check it landed: `npx wrangler d1 execute did-they-build-it-db --remote --command "SELECT site_id, verdict, created_at FROM submissions ORDER BY created_at DESC LIMIT 5"`.
  - Photo upload on cellular → "📷 Added ✓"; verify by fetching the key recorded in D1: `npx wrangler d1 execute did-they-build-it-db --remote --command "SELECT photo_key FROM submissions WHERE photo_key IS NOT NULL LIMIT 1"` then `npx wrangler r2 object get "did-they-build-it-photos/<that photo_key>" --file /tmp/check.jpg` and confirm `/tmp/check.jpg` opens.
  - `/qr` → print/save as PDF for the venue.
  - Airplane mode → submit → "1 report syncing…" → airplane off → clears.
  - Lighthouse against prod from local: `npx --yes @lhci/cli@0.15.1 collect --url=https://did-they-build-it.<subdomain>.workers.dev/ -n 1` — check the performance score ≥ 0.90 (the real target; CI's 0.85 is the noise-tolerant gate).

- [ ] **Step 6: Clean the smoke-test rows before the demo**

```bash
npx wrangler d1 execute did-they-build-it-db --remote --command "DELETE FROM submissions; DELETE FROM devices"
```

(Only run this AFTER confirming everything works — it resets the demo to a clean slate.)

---

## Self-review checklist (run after writing, before execution)

- Spec coverage: map+pins+rings (T6), near me+list (T7), one-tap verify+queue+confetti+tally (T8), photo/note (T9), live status (T10), QR (T11), CI/protection (T1), ETL+coords (T2/3), D1/R2+API (T4/5), deploy+smoke (T12). Nickname/auth, photo display, PWA, rate limiting, admin: out of scope per spec.
- Non-derivable facts used here: EPSG:2019 conversion (empirically verified), sv create flags (verified July 2026), cloudflareTest API (0.18.x — NOT defineWorkersConfig), LHCI median-of-3 config, gh branch-protection JSON, wrangler-action@v4.
