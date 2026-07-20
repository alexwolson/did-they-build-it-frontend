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
