<script lang="ts">
	// Type-only import keeps the ~270KB-gzip maplibre-gl runtime out of the initial
	// route chunk; the real module (JS + CSS) is dynamically imported on idle below.
	import type maplibregl from 'maplibre-gl';
	import type { Point } from 'geojson';
	import { mount, unmount, onMount } from 'svelte';
	import type { SiteFeature, ConditionType } from '$lib/types';
	import { appState } from '$lib/app-state.svelte';
	import { RING_COLORS, dominantType, siteRing } from '$lib/status';
	import { CONDITION_META } from '$lib/condition-meta';
	import { civicFreshMapStyle } from '$lib/map-style';
	import TeardropMarker from './TeardropMarker.svelte';
	import ClusterMarker from './ClusterMarker.svelte';

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

	// Sites/status changed → refresh the clustered source; the 'render' handler
	// then re-syncs the DOM markers (top-level $effect; no-ops until source exists).
	$effect(() => {
		const data = buildMapData(appState.sites, appState.statusCounts);
		if (sourceReady) (mapRef?.getSource('sites') as maplibregl.GeoJSONSource | undefined)?.setData(data);
	});

	function buildMapData(sites: SiteFeature[], counts: typeof appState.statusCounts) {
		return {
			type: 'FeatureCollection' as const,
			features: sites.map((f) => ({
				...f,
				properties: {
					siteId: f.properties.siteId,
					type: dominantType(f.properties),
					ringColor: RING_COLORS[siteRing(f.properties, counts)]
				}
			}))
		};
	}

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

		// DOM markers synced to the clustered source (so we can use our own flat
		// teardrop shapes + duotone icons + Fraunces cluster counts, none of which a
		// WebGL symbol/circle layer can render). Keyed by cluster id / site id so we
		// create, reuse, restatus, and destroy as the viewport and clustering change.
		type Rec = {
			marker: maplibregl.Marker;
			instance: Record<string, unknown>;
			el: HTMLDivElement;
			status?: string;
		};
		const markers: Record<string, Rec> = {};
		let onScreen: Record<string, Rec> = {};

		const cancelIdle = onIdle(async () => {
			const [{ default: maplibregl }] = await Promise.all([
				import('maplibre-gl'),
				import('maplibre-gl/dist/maplibre-gl.css')
			]);

			const map = new maplibregl.Map({
				container,
				style: await civicFreshMapStyle(),
				center: [-79.39, 43.645],
				zoom: 14,
				attributionControl: { compact: true }
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

			function makeTeardrop(type: ConditionType, status: string, siteId: string, coords: [number, number]): Rec {
				const el = document.createElement('div');
				const instance = mount(TeardropMarker, {
					target: el,
					props: { icon: CONDITION_META[type].icon, status }
				});
				el.addEventListener('click', (e) => {
					e.stopPropagation();
					onSelect(siteId);
				});
				const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(coords);
				return { marker, instance, el, status };
			}

			function makeCluster(count: number, clusterId: number, coords: [number, number]): Rec {
				const el = document.createElement('div');
				const instance = mount(ClusterMarker, { target: el, props: { count } });
				el.addEventListener('click', async (e) => {
					e.stopPropagation();
					const src = map.getSource('sites') as maplibregl.GeoJSONSource;
					const zoom = await src.getClusterExpansionZoom(clusterId);
					map.easeTo({ center: coords, zoom });
				});
				const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coords);
				return { marker, instance, el };
			}

			function updateMarkers() {
				if (!map.isSourceLoaded('sites')) return;
				const next: Record<string, Rec> = {};
				for (const f of map.querySourceFeatures('sites')) {
					const coords = (f.geometry as Point).coordinates as [number, number];
					const p = f.properties as {
						cluster?: boolean;
						cluster_id?: number;
						point_count?: number;
						siteId?: string;
						type?: ConditionType;
						ringColor?: string;
					};
					let id: string;
					let rec: Rec;
					if (p.cluster) {
						id = 'c' + p.cluster_id;
						rec = markers[id] ?? makeCluster(p.point_count ?? 0, p.cluster_id ?? 0, coords);
					} else {
						id = 's' + p.siteId;
						rec = markers[id] ?? makeTeardrop(p.type ?? 'landscaping', p.ringColor ?? '#9aa8a2', p.siteId ?? '', coords);
						if (rec.status !== p.ringColor) {
							const drop = rec.el.querySelector('.drop') as HTMLElement | null;
							if (drop && p.ringColor) drop.style.borderColor = p.ringColor;
							rec.status = p.ringColor;
						}
					}
					markers[id] = rec;
					next[id] = rec;
					if (!onScreen[id]) rec.marker.addTo(map);
				}
				for (const id in onScreen) {
					if (!next[id]) {
						onScreen[id].marker.remove();
						unmount(onScreen[id].instance);
						delete markers[id];
					}
				}
				onScreen = next;
			}

			map.on('load', () => {
				map.addSource('sites', {
					type: 'geojson',
					data: buildMapData(appState.sites, appState.statusCounts),
					cluster: true,
					clusterMaxZoom: 15,
					clusterRadius: 55,
					promoteId: 'siteId'
				});
				// Invisible circle layer anchors the source so querySourceFeatures returns
				// its clustered + unclustered features; the visible markers are DOM (above).
				map.addLayer({
					id: 'sites-src',
					type: 'circle',
					source: 'sites',
					paint: { 'circle-radius': 1, 'circle-opacity': 0 }
				});

				map.on('render', updateMarkers);
				map.on('moveend', updateMarkers);

				sourceReady = true;
				registerMap?.(map, geolocate);
			});
		});

		return () => {
			cancelIdle();
			for (const id in markers) {
				markers[id].marker.remove();
				unmount(markers[id].instance);
			}
			mapForCleanup?.remove();
		};
	});
</script>

<div class="map" bind:this={container}></div>

<style>
	.map {
		position: fixed;
		inset: 0;
		/* Civic Fresh land colour so the shell reads as "map" from first paint,
		   no white flash while MapLibre boots on idle. */
		background-color: #e7eee9;
	}
	/* We trigger geolocation from our own FAB. */
	:global(.maplibregl-ctrl-geolocate) {
		display: none;
	}
</style>
