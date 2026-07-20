import proj4 from 'proj4';

// City of Toronto Development Applications X/Y: EPSG:2019 (NAD27(76) / MTM zone 10).
// towgs84=-10,158,187 reproduces PROJ's authoritative NTv2 grid transform
// (ca_nrc_MAY76V20) to <0.9 m across Toronto. Do not reuse far outside the GTA.
const EPSG_2019 =
	'+proj=tmerc +lat_0=0 +lon_0=-79.5 +k=0.9999 +x_0=304800 +y_0=0 ' +
	'+ellps=clrk66 +towgs84=-10,158,187 +units=m +no_defs';

export function mtm10ToWgs84(x: number, y: number): { lat: number; lng: number } {
	const [lng, lat] = proj4(EPSG_2019, 'EPSG:4326', [x, y]);
	return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}
