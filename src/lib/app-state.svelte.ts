import type { SiteFeature, StatusCounts } from '$lib/types';

class AppState {
	sites = $state<SiteFeature[]>([]);
	statusCounts = $state<Record<string, StatusCounts>>({});
	userPos = $state<{ lat: number; lng: number; accuracyM: number } | null>(null);
	tally = $state(0); // verdicts sent this session
	pendingSync = $state(0); // queued submissions awaiting network

	// Total verdicts the whole community has logged — powers the collective
	// "N promises checked tonight" counter (the everyone's-out-here signature).
	get totalChecked() {
		let n = 0;
		for (const c of Object.values(this.statusCounts)) n += c.present + c.absent + c.unclear;
		return n;
	}
}

export const appState = new AppState();
