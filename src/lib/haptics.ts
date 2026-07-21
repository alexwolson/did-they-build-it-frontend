// Best-effort haptic feedback. navigator.vibrate is Android/Chromium only — iOS
// Safari does not implement the Vibration API, so this silently no-ops on
// iPhone/iPad (there is no reliable web haptics path on iOS). Honors
// prefers-reduced-motion: the buzz is decorative, like the confetti it pairs
// with. Progressive enhancement — never assume it fired.

// A celebratory buzz–pause–buzz for a first verdict; a light tick otherwise.
export const HAPTIC_CELEBRATE: number[] = [18, 45, 30];
export const HAPTIC_TICK = 12;

export function haptic(pattern: number | number[] = HAPTIC_TICK): void {
	if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
	if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	try {
		navigator.vibrate(pattern);
	} catch {
		// Some engines throw if called outside a user gesture — non-fatal.
	}
}
