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

// A GeoJSON polygon approximating a circle of `radiusM` metres on the ground
// around [lng, lat]. Used to draw the "scan around here" zone on the map: a
// real ground-distance ring (unlike a pixel-radius circle layer, it stays the
// right physical size as you zoom). Longitude degrees shrink with latitude, so
// the lng step is divided by cos(lat) to keep the shape round rather than oval.
const M_PER_DEG_LAT = 111_320;
export function circlePolygon(
	lng: number,
	lat: number,
	radiusM: number,
	steps = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
	const dLat = radiusM / M_PER_DEG_LAT;
	const dLng = radiusM / (M_PER_DEG_LAT * Math.cos(rad(lat)));
	const ring: [number, number][] = [];
	for (let i = 0; i <= steps; i++) {
		const t = (i / steps) * 2 * Math.PI;
		ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
	}
	return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
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
