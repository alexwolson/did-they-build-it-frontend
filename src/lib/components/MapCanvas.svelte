<script lang="ts">
	// Type-only import keeps the ~270KB-gzip maplibre-gl runtime out of the initial
	// route chunk; the real module (JS + CSS) is dynamically imported in onMount.
	import type maplibregl from 'maplibre-gl';
	import type { Point } from 'geojson';
	import { mount, unmount, onMount } from 'svelte';
	import type { SiteFeature, ConditionType } from '$lib/types';
	import { appState } from '$lib/app-state.svelte';
	import { RING_COLORS, dominantType, siteRing } from '$lib/status';
	import { CONDITION_META } from '$lib/condition-meta';
	import { civicFreshMapStyle } from '$lib/map-style';
	import { circlePolygon } from '$lib/geo';
	import TeardropMarker from './TeardropMarker.svelte';
	import ClusterMarker from './ClusterMarker.svelte';

	let {
		onSelect,
		selectedSiteId = null,
		registerMap
	}: {
		onSelect: (siteId: string) => void;
		selectedSiteId?: string | null;
		registerMap?: (map: maplibregl.Map, geolocate: maplibregl.GeolocateControl) => void;
	} = $props();

	let container: HTMLDivElement;
	let mapRef: maplibregl.Map | undefined;
	let sourceReady = $state(false);
	// The branded boot splash covers the map shell until the base map has painted,
	// so first paint shows the app identity (a fast, SSR'd LCP element) instead of a
	// blank land-coloured rectangle that only resolves once MapLibre finishes booting.
	let booted = $state(false);

	// The "scan around here" zone (~55 m circle) for the selected site: a real
	// ground-distance ring so it stays the right physical size at any zoom. All we
	// have is a point per site (no footprint), so this reads as "look around here",
	// not a precise outline. applyHighlight is defined once the map loads; the
	// $effect below re-runs it whenever the selection — or the sites list — changes.
	const SCAN_RADIUS_M = 55;
	const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
	let applyHighlight: ((id: string | null) => void) | undefined;

	$effect(() => {
		const id = selectedSiteId;
		void appState.sites; // re-apply once site data arrives (e.g. deep-linked /site/x)
		if (sourceReady) applyHighlight?.(id);
	});

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

	onMount(() => {
		let cancelled = false;
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
			z?: string; // last-written z-index, so we only touch the DOM when it changes
		};
		const markers: Record<string, Rec> = {};
		let onScreen: Record<string, Rec> = {};
		let currentSelected: string | null = null;

		// Boot the map eagerly (no requestIdleCallback gate): the map is the LCP
		// element, so kicking off the ~262 KB maplibre chunk + style fetch the moment
		// we mount lets it download, parse, and request tiles as early as possible.
		// Deferring to idle only pushed LCP later; the boot splash covers the gap.
		(async () => {
			const [{ default: maplibregl }] = await Promise.all([
				import('maplibre-gl'),
				import('maplibre-gl/dist/maplibre-gl.css')
			]);
			if (cancelled) return; // unmounted while the runtime was still loading

			const map = new maplibregl.Map({
				container,
				style: await civicFreshMapStyle(),
				center: [-79.3957, 43.6605], // UofT St. George campus (where the demo sites are)
				zoom: 14.3,
				attributionControl: { compact: true },
				// North-up scanning tool: rotation/pitch add no value and there's no reset
				// control, so an accidental two-finger twist (easy while pinch-zooming) would
				// leave the map stuck tilted. Disable rotation everywhere but keep pinch-zoom.
				dragRotate: false,
				pitchWithRotate: false
			});
			map.touchZoomRotate.disableRotation(); // two-finger pinch still zooms; twist no longer rotates
			map.keyboard.disableRotation();

			// Reveal the live map once the base style has painted; the timeout is a
			// safety net so a slow/failed tile or style fetch can never trap the user
			// behind the splash.
			const reveal = () => { if (!cancelled) booted = true; };
			map.on('load', reveal);
			setTimeout(reveal, 8000);

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
				if (cancelled || !map.isSourceLoaded('sites')) return;
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
						// Lift the selected pin above its neighbours so it's never occluded
						// by the scan-zone ring or nearby markers. Only write to the DOM when
						// it actually changes — this runs for every visible pin per update.
						const wantZ = p.siteId === currentSelected ? '5' : '';
						if (rec.z !== wantZ) {
							rec.el.style.zIndex = wantZ;
							rec.z = wantZ;
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

				// Selected-site "scan zone": flat soft-filled circle + solid ring, drawn
				// under the DOM markers. Empty until a site is selected.
				map.addSource('scan-zone', { type: 'geojson', data: EMPTY_FC });
				map.addLayer({
					id: 'scan-zone-fill',
					type: 'fill',
					source: 'scan-zone',
					paint: { 'fill-color': '#0fa98e', 'fill-opacity': 0.14 }
				});
				map.addLayer({
					id: 'scan-zone-ring',
					type: 'line',
					source: 'scan-zone',
					paint: { 'line-color': '#0fa98e', 'line-width': 2, 'line-opacity': 0.9 }
				});

				applyHighlight = (id: string | null) => {
					currentSelected = id;
					const src = map.getSource('scan-zone') as maplibregl.GeoJSONSource | undefined;
					const site = id
						? appState.sites.find((s) => s.properties.siteId === id)
						: undefined;
					if (!site) {
						src?.setData(EMPTY_FC);
						map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }); // undo the peek offset
						updateMarkers();
						return;
					}
					const [lng, lat] = site.geometry.coordinates;
					src?.setData({
						type: 'FeatureCollection',
						features: [circlePolygon(lng, lat, SCAN_RADIUS_M)]
					});
					updateMarkers(); // restyle the now-selected marker
					// Fly to the site, reserving the bottom ~72% of the viewport for the
					// detail sheet so the pin + zone sit in the visible strip above it
					// ("peek above sheet"). MapLibre makes this an instant jump when the
					// user prefers reduced motion. Zoom in enough to un-cluster and read
					// the ~55 m ring clearly.
					map.flyTo({
						center: [lng, lat],
						zoom: Math.max(map.getZoom(), 16.5),
						padding: { top: 56, bottom: Math.round(window.innerHeight * 0.72), left: 24, right: 24 },
						duration: 700
					});
				};

				// MapLibre already repositions the DOM markers on every frame; the
				// reconciliation above only needs to run when the *set* of visible/
				// clustered features changes (pan brings pins in, zoom splits clusters).
				// Running it on every `render` frame made inertial panning janky, so
				// throttle it to ~11 fps during continuous movement and take one exact
				// pass on moveend. The pins still follow the map smoothly frame-to-frame.
				let markerTimer = 0;
				let lastMarkerRun = 0;
				const MARKER_THROTTLE_MS = 90;
				function scheduleMarkers() {
					if (markerTimer) return; // a run is already pending
					const wait = Math.max(0, MARKER_THROTTLE_MS - (performance.now() - lastMarkerRun));
					markerTimer = window.setTimeout(() => {
						markerTimer = 0;
						lastMarkerRun = performance.now();
						updateMarkers();
					}, wait);
				}
				map.on('render', scheduleMarkers);
				map.on('moveend', () => {
					if (markerTimer) {
						clearTimeout(markerTimer);
						markerTimer = 0;
					}
					lastMarkerRun = performance.now();
					updateMarkers(); // exact final state, no throttle lag once movement stops
				});

				sourceReady = true;
				registerMap?.(map, geolocate);
				applyHighlight(selectedSiteId); // honour a deep-linked /site/[id] at load
			});
		})();

		return () => {
			cancelled = true;
			for (const id in markers) {
				markers[id].marker.remove();
				unmount(markers[id].instance);
			}
			mapForCleanup?.remove();
		};
	});
</script>

<div class="map" bind:this={container}></div>

<!-- SSR'd branded boot cover. It paints at first contentful paint, giving the page
     a large, on-identity Largest-Contentful-Paint element (the title) instead of
     waiting ~5s for the map's attribution text, then fades to reveal the live map. -->
<div class="boot" class:booted aria-hidden={booted}>
	<div class="boot-inner">
		<h1 class="boot-title">Did They Build It?</h1>
		<p class="boot-tag">Did Toronto developers build what they promised?</p>
	</div>
</div>

<style>
	.map {
		position: fixed;
		inset: 0;
		/* Civic Fresh land colour so the shell reads as "map" from first paint,
		   no white flash while MapLibre boots. */
		background-color: #e7eee9;
	}
	.boot {
		position: fixed;
		inset: 0;
		z-index: 50; /* over the map + controls while booting; fades to reveal them */
		display: grid;
		place-items: center;
		padding: 24px;
		text-align: center;
		background: var(--paper);
	}
	.boot.booted {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition: opacity 500ms ease, visibility 0s linear 500ms;
	}
	.boot-title {
		margin: 0;
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 48, 'SOFT' 60, 'WONK' 1;
		font-weight: 700;
		font-size: clamp(2rem, 9vw, 3.25rem);
		line-height: 1.05;
		letter-spacing: -0.01em;
		color: var(--ink);
	}
	.boot-tag {
		margin: 12px auto 0;
		max-width: 24ch;
		font-family: var(--font-body);
		font-size: 1rem;
		line-height: 1.35;
		color: var(--ink-soft);
	}
	@media (prefers-reduced-motion: reduce) {
		.boot.booted {
			transition: none;
		}
	}
	/* We trigger geolocation from our own FAB. */
	:global(.maplibregl-ctrl-geolocate) {
		display: none;
	}
</style>
