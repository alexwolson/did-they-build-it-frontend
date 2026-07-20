import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => ({ siteId: params.siteId });
