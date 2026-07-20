// tests/unit/mtm.test.ts
import { describe, expect, it } from 'vitest';
import { mtm10ToWgs84 } from '../../etl/mtm';

// Ground truth: pyproj EPSG:2019 -> EPSG:4326 with the ca_nrc_MAY76V20 grid.
const CASES: Array<{ name: string; x: number; y: number; lat: number; lng: number }> = [
	{ name: '147 Spadina Ave', x: 313206.52, y: 4834020.264, lat: 43.64808, lng: -79.395565 },
	{ name: '64 Bathurst St', x: 312647.294, y: 4833422.48, lat: 43.642652, lng: -79.402444 },
	{ name: '121 St Patrick St', x: 313686.943, y: 4834620.623, lat: 43.653514, lng: -79.389696 }
];

// ~30 m in degrees at Toronto's latitude — generous vs the validated <1 m fit,
// tight enough to catch a wrong datum (~200 m) or a wrong zone (kilometres).
const EPS = 0.0003;

describe('mtm10ToWgs84 (EPSG:2019 → WGS84)', () => {
	for (const c of CASES) {
		it(`converts ${c.name}`, () => {
			const { lat, lng } = mtm10ToWgs84(c.x, c.y);
			expect(Math.abs(lat - c.lat)).toBeLessThan(EPS);
			expect(Math.abs(lng - c.lng)).toBeLessThan(EPS);
		});
	}
});
