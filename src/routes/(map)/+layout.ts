import type { LayoutLoad } from './$types';
import type { SitesCollection } from '$lib/types';

export const load: LayoutLoad = async ({ fetch }) => {
	const res = await fetch('/data/sites.json');
	const sites: SitesCollection = await res.json();
	return { sites };
};
