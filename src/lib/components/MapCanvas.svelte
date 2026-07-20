<script lang="ts">
	// Type-only: keeps `maplibregl.Map` etc. usable as types without pulling the ~270KB-gzip
	// maplibre-gl runtime into the initial route chunk. The real module (JS + CSS) is loaded
	// with a dynamic import() inside the idle-deferred callback below, so parsing/compiling it
	// happens off the critical path too — that parse/compile cost was itself a big chunk of the
	// pre-optimization Total Blocking Time, on top of the map's own boot work.
	import type maplibregl from 'maplibre-gl';
	import { onMount } from 'svelte';
	import type { Point } from 'geojson';
	import type { SiteFeature } from '$lib/types';
	import { appState } from '$lib/app-state.svelte';
	import { RING_COLORS, dominantType, siteRing } from '$lib/status';
	import { CONDITION_META } from '$lib/condition-meta';

	let {
		onSelect,
		registerMap
	}: {
		onSelect: (siteId: string) => void;
		registerMap?: (map: maplibregl.Map, geolocate: maplibregl.GeolocateControl) => void;
	} = $props();

	let container: HTMLDivElement;
	let mapRef: maplibregl.Map | undefined;
	let sourceReady = $state(false);

	// Status or sites changed → refresh source data (368 features: trivially cheap).
	// Top-level $effect — effects CANNOT be created inside onMount callbacks
	// (effect_orphan). This one no-ops until the source exists.
	$effect(() => {
		const data = buildMapData(appState.sites, appState.statusCounts);
		if (sourceReady) (mapRef?.getSource('sites') as maplibregl.GeoJSONSource | undefined)?.setData(data);
	});

	export function buildMapData(sites: SiteFeature[], counts: typeof appState.statusCounts) {
		return {
			type: 'FeatureCollection' as const,
			features: sites.map((f) => ({
				...f,
				properties: {
					siteId: f.properties.siteId,
					icon: `icon-${dominantType(f.properties)}`,
					ringColor: RING_COLORS[siteRing(f.properties, counts)],
					nConditions: f.properties.conditions.length
				}
			}))
		};
	}

	function emojiIcon(emoji: string, size = 64): ImageData {
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const ctx = c.getContext('2d')!;
		ctx.font = `${Math.round(size * 0.72)}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
		return ctx.getImageData(0, 0, size, size);
	}

	// MapLibre's boot (style parse, WebGL context, tile decode) is the dominant chunk of the
	// page's main-thread cost (Total Blocking Time). The container paints instantly via CSS
	// (see .map background below) so there's no white flash and FCP/LCP land on the shell —
	// then we push the actual `new maplibregl.Map(...)` past first paint using idle time.
	// requestIdleCallback isn't in Safari, so it falls back to a short setTimeout there; either
	// way the map still appears on its own within a moment of load — no interaction required.
	function onIdle(cb: () => void): () => void {
		const w = window as typeof window & {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
			cancelIdleCallback?: (handle: number) => void;
		};
		if (typeof w.requestIdleCallback === 'function') {
			const handle = w.requestIdleCallback(cb, { timeout: 200 });
			return () => w.cancelIdleCallback?.(handle);
		}
		const handle = setTimeout(cb, 1);
		return () => clearTimeout(handle);
	}

	onMount(() => {
		let mapForCleanup: maplibregl.Map | undefined;

		const cancelIdle = onIdle(async () => {
			const [{ default: maplibregl }] = await Promise.all([
				import('maplibre-gl'),
				import('maplibre-gl/dist/maplibre-gl.css')
			]);

			const map = new maplibregl.Map({
				container,
				style: 'https://tiles.openfreemap.org/styles/bright',
				center: [-79.39, 43.645],
				zoom: 14, // start close enough that the colourful per-type emoji pins show, not only clusters
				attributionControl: { compact: true } // OpenFreeMap/OSM attribution comes from the style — required, do not remove
			});

			const geolocate = new maplibregl.GeolocateControl({
				positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
				trackUserLocation: true,
				showUserLocation: true,
				showAccuracyCircle: true,
				fitBoundsOptions: { maxZoom: 16 }
			});
			map.addControl(geolocate); // hidden via CSS; triggered from our FAB
			geolocate.on('geolocate', (pos) => {
				appState.userPos = {
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					accuracyM: pos.coords.accuracy
				};
			});

			mapRef = map;
			mapForCleanup = map;

			map.on('load', () => {
				for (const [type, meta] of Object.entries(CONDITION_META)) {
					map.addImage(`icon-${type}`, emojiIcon(meta.emoji), { pixelRatio: 2 });
				}

				map.addSource('sites', {
					type: 'geojson',
					data: buildMapData(appState.sites, appState.statusCounts),
					cluster: true,
					clusterMaxZoom: 15,
					clusterRadius: 55,
					promoteId: 'siteId'
				});

				map.addLayer({
					id: 'clusters',
					type: 'circle',
					source: 'sites',
					filter: ['has', 'point_count'],
					paint: {
						'circle-color': '#0d9488',
						'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24],
						'circle-stroke-width': 3,
						'circle-stroke-color': '#ffffff'
					}
				});
				map.addLayer({
					id: 'cluster-count',
					type: 'symbol',
					source: 'sites',
					filter: ['has', 'point_count'],
					layout: {
						'text-field': ['get', 'point_count_abbreviated'],
						'text-font': ['Noto Sans Regular'],
						'text-size': 13
					},
					paint: { 'text-color': '#ffffff' }
				});
				// Status ring under the icon — the map accumulates the evening's story.
				map.addLayer({
					id: 'site-rings',
					type: 'circle',
					source: 'sites',
					filter: ['!', ['has', 'point_count']],
					paint: {
						'circle-color': ['get', 'ringColor'],
						'circle-radius': 15,
						'circle-opacity': 0.95,
						'circle-stroke-width': 2.5,
						'circle-stroke-color': '#ffffff'
					}
				});
				map.addLayer({
					id: 'site-icons',
					type: 'symbol',
					source: 'sites',
					filter: ['!', ['has', 'point_count']],
					layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.42, 'icon-allow-overlap': true }
				});
				// Spec: multi-condition sites get a count badge.
				map.addLayer({
					id: 'site-count',
					type: 'symbol',
					source: 'sites',
					filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'nConditions'], 1]],
					layout: {
						'text-field': ['to-string', ['get', 'nConditions']],
						'text-font': ['Noto Sans Bold'],
						'text-size': 11,
						'text-offset': [1.1, -1.1],
						'text-allow-overlap': true
					},
					paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 }
				});

				map.on('click', 'clusters', async (e) => {
					const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
					const source = map.getSource('sites') as maplibregl.GeoJSONSource;
					const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
					map.easeTo({ center: (feature.geometry as Point).coordinates as [number, number], zoom });
				});
				map.on('click', ['site-rings', 'site-icons'], (e) => {
					const f = e.features?.[0];
					if (f) onSelect(String(f.properties.siteId));
				});
				for (const layer of ['clusters', 'site-rings', 'site-icons']) {
					map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
					map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
				}

				sourceReady = true;
				registerMap?.(map, geolocate);
			});
		});

		return () => {
			cancelIdle();
			mapForCleanup?.remove();
		};
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		position: fixed;
		inset: 0;
		/* Matches the positron style's `background` layer (land fill) so the shell reads as
		   "map" from first paint instead of flashing white while MapLibre boots on idle.
		   Note: this is deliberately background-color, not background-image — Chrome's LCP
		   algorithm doesn't treat a solid background-color as a paintable candidate, so this
		   doesn't move the LCP metric itself (that stays pinned to whatever the map ultimately
		   paints, e.g. the required attribution text once the style loads). It's here purely
		   for perceived quality: no white flash while MapLibre boots on idle time. */
		background-color: rgb(242, 243, 240);
	}
	/* We trigger geolocation from our own FAB */
	:global(.maplibregl-ctrl-geolocate) {
		display: none;
	}
</style>
