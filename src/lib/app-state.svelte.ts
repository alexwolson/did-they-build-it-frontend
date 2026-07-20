import type { SiteFeature, StatusCounts } from '$lib/types';

class AppState {
	sites = $state<SiteFeature[]>([]);
	statusCounts = $state<Record<string, StatusCounts>>({});
	userPos = $state<{ lat: number; lng: number; accuracyM: number } | null>(null);
	tally = $state(0); // verdicts sent this session
	pendingSync = $state(0); // queued submissions awaiting network
}

export const appState = new AppState();
