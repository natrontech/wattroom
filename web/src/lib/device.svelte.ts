import { page } from '$app/state';

/**
 * What this device can do, and whether it is a spectator.
 *
 * WATTROOM.md scopes phones as read-only spectators, and that is locked. What
 * was NOT locked is how the app says so: until #412 a narrow viewport was
 * bounced out of the room entirely, onto a read-only page the redesign never
 * touched. A phone gets the real room now, minus the affordances that would
 * fail on it (`ux.md`: hidden or disabled with a reason, never a button that
 * errors on click).
 *
 * A narrow WINDOW and a phone are different questions (ADR-0020), so the
 * predicate below takes three signals and not one:
 *
 * - **narrow** — below ADR-0020's `md` boundary, which is the width that makes
 *   the sidebar a drawer. Alone it is just a small window.
 * - **coarse** — the pointer is a finger. A desktop browser dragged narrow
 *   keeps its mouse, and keeps the cockpit with it.
 * - **no Web Bluetooth** — nothing on this device can reach a trainer. This is
 *   the iOS gap WATTROOM.md names; Chrome on Android has it, and there
 *   pairing genuinely works, so refusing it would be a lie about the device.
 */
export const PHONE_MAX_PX = 767;

export interface DeviceEnv {
	/** Viewport below ADR-0020's `md` boundary. */
	narrow: boolean;
	/** The pointer is a finger. */
	coarse: boolean;
	/** Web Bluetooth exists, so a trainer could be paired here. */
	bluetooth: boolean;
	/** `?full=1` — the rider asked for the cockpit on this device anyway. */
	cockpit: boolean;
}

/**
 * Whether to draw the room without its trainer controls.
 *
 * `?full=1` used to be the escape hatch out of the watch page's dead end. The
 * dead end is gone, so it keeps the meaning it always had — "give this device
 * the cockpit anyway" — and now spends it on the gate rather than a redirect,
 * which is why a bookmarked link still does what its owner wanted.
 */
export function isSpectator(env: DeviceEnv): boolean {
	if (env.cockpit) return false;
	return env.narrow && env.coarse && !env.bluetooth;
}

/** A media query as reactive state; `false` everywhere there is no window. */
function watchMedia(query: string): () => boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return () => false;
	const mql = window.matchMedia(query);
	let matches = $state(mql.matches);
	mql.addEventListener('change', (event) => (matches = event.matches));
	return () => matches;
}

const narrow = watchMedia(`(max-width: ${PHONE_MAX_PX}px)`);
const coarse = watchMedia('(pointer: coarse)');

export const device = {
	/** Below `md`: the sidebar is a drawer and content is the screen. */
	get narrow() {
		return narrow();
	},
	get coarse() {
		return coarse();
	},
	get bluetooth() {
		return typeof navigator !== 'undefined' && !!navigator.bluetooth;
	},
	get cockpit() {
		return typeof window !== 'undefined' && page.url.searchParams.has('full');
	},
	/** No pairing, no ERG, no session control — the phone's answer. */
	get spectator() {
		return isSpectator({
			narrow: this.narrow,
			coarse: this.coarse,
			bluetooth: this.bluetooth,
			cockpit: this.cockpit,
		});
	},
};
