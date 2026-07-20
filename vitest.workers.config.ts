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
