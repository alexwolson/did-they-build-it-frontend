import type { PageLoad } from './$types';

// Site data is loaded client-side (see (map)/+layout.svelte's loadSites), so the
// site is resolved from appState in +page.svelte. A cold SSR deep-link therefore
// renders the sheet's fallback until the client fetch populates appState — an
// accepted trade-off for keeping the 118 KB site payload off SSR and avoiding
// the Cloudflare same-zone-subrequest error (1042) that an SSR fetch would hit.
export const load: PageLoad = ({ params }) => {
	return { siteId: params.siteId };
};
