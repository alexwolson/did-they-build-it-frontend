import type { PageLoad } from './$types';

// The (map)/+layout.ts universal load already fetched sites.json — server-side
// on a cold deep-link too. Resolve the site here (via parent()) instead of
// relying solely on appState.sites, which is populated by a client-only
// effect and is therefore empty during SSR. That's what made a shared/social
// deep-link render "Site not found" before hydration.
export const load: PageLoad = async ({ params, parent }) => {
	const { sites } = await parent();
	const site = sites.features.find((f) => f.properties.siteId === params.siteId);
	return { siteId: params.siteId, site };
};
