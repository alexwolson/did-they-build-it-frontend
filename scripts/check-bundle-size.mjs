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
