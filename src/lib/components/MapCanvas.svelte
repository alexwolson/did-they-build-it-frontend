<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
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

	onMount(() => {
		const map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/bright',
			center: [-79.39, 43.645],
			zoom: 13,
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
					'circle-color': '#0f766e',
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

		return () => map.remove();
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		position: fixed;
		inset: 0;
	}
	/* We trigger geolocation from our own FAB */
	:global(.maplibregl-ctrl-geolocate) {
		display: none;
	}
</style>
