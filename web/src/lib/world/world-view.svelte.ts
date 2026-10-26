/**
 * A ride's view on a road, held for the ride (#3080, ADR-0066): the riding
 * surfaces ask rideView() once, and after that only a failure or the rider's
 * own Flat / 3D tap moves it — never reduced motion switched on mid-ride,
 * never a second that drew well again. Loads no three.js.
 */
import { prefersReducedMotion } from '$lib/motion';
import { PHONE_MAX_PX } from '$lib/device.svelte';
import { worldFits } from '$lib/session/docks';
import { play } from '$lib/sound/cues';
import { setWorldMode, worldMode, type WorldMode } from './mode';
import {
	rideView,
	type Failure,
	type RideView,
	type SkylineReason,
} from './ride-view';

// The window's size, kept for every ride on the page by one listener.
const viewport = $state({
	width: typeof window === 'undefined' ? Infinity : window.innerWidth,
	height: typeof window === 'undefined' ? Infinity : window.innerHeight,
});
if (typeof window !== 'undefined')
	window.addEventListener('resize', () => {
		viewport.width = window.innerWidth;
		viewport.height = window.innerHeight;
	});

let caps: { webgl2: boolean; multiDraw: boolean } | null = null;

/** What this browser can draw, asked once a page on a throwaway context let go at once. */
function capabilities() {
	if (caps) return caps;
	try {
		const gl = document.createElement('canvas').getContext('webgl2');
		caps = { webgl2: !!gl, multiDraw: !!gl?.getExtension('WEBGL_multi_draw') };
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	} catch {
		caps = { webgl2: false, multiDraw: false };
	}
	return caps;
}

export function createWorldView() {
	let failure: Failure | null = null;
	const decide = (): RideView =>
		rideView({
			mode: worldMode(),
			reducedMotion: prefersReducedMotion.current,
			...capabilities(),
			failure,
		});
	let view = $state<RideView>(decide());
	// The window's height is live, unlike a failure: the world comes back
	// the moment the window holds its panels again.
	const shown = (): RideView =>
		view === 'world' &&
		!worldFits(viewport.width <= PHONE_MAX_PX, viewport.height)
			? { skyline: 'short' }
			: view;
	const reason = (): SkylineReason | null => {
		const v = shown();
		return v === 'world' ? null : v.skyline;
	};
	return {
		/** The world draws in slot 2, docked around the road: a desk or a TV. */
		get on() {
			return shown() === 'world' && viewport.width > PHONE_MAX_PX;
		},
		/** The world draws as a band in a phone's column (#3676); the slots stay flat. */
		get band() {
			return shown() === 'world' && viewport.width <= PHONE_MAX_PX;
		},
		/** Why this ride is on the Skyline; null in the world. */
		get reason() {
			return reason();
		},
		fail(why: Failure) {
			// A world that goes flat says so (ux.md: a state change announces
			// itself with a sound and a visual, the visual the view switch's
			// 3D segment): a rider who looked away missed it (#4217).
			if (!failure) play('fault');
			failure = why;
			view = decide();
		},
		/**
		 * The world's own chunk (three.js), loaded for the ride; a renderer
		 * that does not load is this ride's failure, and the Skyline's.
		 */
		load() {
			return import('$lib/world/RideWorld.svelte').catch((err: unknown) => {
				console.error('world: the renderer did not load', err);
				this.fail('build-failed');
				throw err;
			});
		},
		/** Full, Steady or Light, as the rider chose; Full while nothing was. */
		get look(): Exclude<WorldMode, 'flat'> {
			const m = worldMode();
			return m === null || m === 'flat' ? 'full' : m;
		},
		/** The flat road, from now on, on this device: the world's Flat button and its context menu. */
		flatten() {
			setWorldMode('flat');
			view = decide();
		},
		/**
		 * The only way into the world this ride; a choice it overrides is the
		 * rider's new one: Full from Flat, Steady under reduced motion
		 * (ADR-0079), and what they had after a failure.
		 */
		retry() {
			const was = reason();
			if (was === 'chosen') setWorldMode('full');
			if (was === 'motion') setWorldMode('steady');
			failure = null;
			view = decide();
		},
	};
}
