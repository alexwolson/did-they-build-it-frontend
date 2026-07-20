import type { StyleSpecification } from 'maplibre-gl';

// Civic Fresh basemap: fetch OpenFreeMap's minimal "positron" style and recolor
// every layer to the palette, hiding POI/transit clutter. Verified against live
// Toronto tiles. Falls back to the stock positron URL if the fetch/recolor fails
// so the map always renders.
const POSITRON = 'https://tiles.openfreemap.org/styles/positron';

const LAND = '#E7EEE9';
const WATER = '#C6DEE7';
const PARK = '#D3E6D2';
const BUILDING = '#E2EAE4';
const ROAD = '#FCFEFD';
const CASING = '#E1E9E2';
const INK = '#12322B';
const BOUND = '#C6D2CB';

export async function civicFreshMapStyle(): Promise<StyleSpecification | string> {
	try {
		const style = (await (await fetch(POSITRON)).json()) as StyleSpecification;
		for (const layer of style.layers) {
			const id = (layer.id || '').toLowerCase();
			const t = layer.type;
			const anyLayer = layer as unknown as {
				paint?: Record<string, unknown>;
				layout?: Record<string, unknown>;
			};
			anyLayer.paint = anyLayer.paint || {};
			anyLayer.layout = anyLayer.layout || {};
			const P = (k: string, v: unknown) => (anyLayer.paint![k] = v);

			if (/poi|transit|aeroway|aerodrome|airport|ferry|shield|motorway_junction/.test(id)) {
				anyLayer.layout!.visibility = 'none';
				continue;
			}
			if (t === 'background') P('background-color', LAND);
			else if (t === 'fill') {
				if (/water/.test(id)) P('fill-color', WATER);
				else if (
					/(park|wood|grass|forest|landcover|landuse|golf|cemetery|pitch|garden|meadow|scrub|farmland|green|nature|recreation)/.test(
						id
					)
				)
					P('fill-color', PARK);
				else if (/building/.test(id)) P('fill-color', BUILDING);
				else if (/(sand|beach|residential|suburb|neighbourhood|industrial|commercial)/.test(id))
					P('fill-color', LAND);
			} else if (t === 'line') {
				if (/(water|river|canal|stream|waterway)/.test(id)) P('line-color', WATER);
				else if (/(casing|outline|bg)/.test(id)) P('line-color', CASING);
				else if (
					/(motorway|trunk|primary|secondary|tertiary|minor|road|street|highway|transportation|bridge|tunnel|service|track|path|pedestrian|rail)/.test(
						id
					)
				)
					P('line-color', ROAD);
				else if (/(boundary|admin)/.test(id)) P('line-color', BOUND);
				else if (/building/.test(id)) P('line-color', BUILDING);
			} else if (t === 'symbol') {
				P('text-color', INK);
				P('text-halo-color', 'rgba(255,255,255,0.9)');
				P('text-halo-width', 1.4);
			}
		}
		return style;
	} catch {
		return POSITRON; // stock positron is still calmer than bright; never leaves the map blank
	}
}
