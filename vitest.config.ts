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
