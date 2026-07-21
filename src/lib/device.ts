const KEY = 'dtbi:device';

export function deviceId(): string {
	let id = localStorage.getItem(KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(KEY, id);
	}
	return id;
}

// --- Adaptive loading -------------------------------------------------------
// Best-effort device-capability hints. The underlying signals
// (navigator.deviceMemory, navigator.connection.saveData) are Chromium/Android-
// only and undefined on iOS Safari and during SSR. Contract: absence == treat as
// capable. iOS and unknown devices always get the full experience; we only
// degrade when a device *positively* reports a weak signal, so the capable code
// path stays byte-identical to not having this at all.

interface NavigatorConnection {
	saveData?: boolean;
	effectiveType?: string;
}

/**
 * True only when the device positively reports low RAM (deviceMemory ≤ 2 GB) or
 * the user opted into data-saver. Deliberately narrow: we skip hardwareConcurrency
 * (iOS reports it, and core count is a poor GPU proxy) and effectiveType (a
 * network, not device-tier, signal — irrelevant to the DOM-marker cost this gates).
 */
export function isLowEndDevice(): boolean {
	if (typeof navigator === 'undefined') return false;
	const nav = navigator as Navigator & {
		deviceMemory?: number;
		connection?: NavigatorConnection;
	};
	if (nav.connection?.saveData) return true;
	if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) return true;
	return false;
}
