import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Inline page CSS below this size (uncompressed bytes) into a <style> in
			// the SSR <head> instead of a render-blocking <link>. On slow mobile
			// networks the extra CSS round-trips delayed first render by ~590 ms
			// (Lighthouse), and the boot splash — our LCP element — needs its styles
			// present at first paint. Every app route sheet is <7 KB (map layout is
			// ~5.5 KB incl. the splash; the largest, the /site route, is ~6.4 KB), so
			// 8192 inlines them all and leaves only maplibre's 69 KB sheet (a
			// client-side dynamic import, never in the initial <head>) as a request.
			inlineStyleThreshold: 8192
		})
	]
});
