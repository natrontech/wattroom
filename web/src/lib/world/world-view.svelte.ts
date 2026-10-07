/**
 * A ride's view on a road, held for the ride (#3080, ADR-0066): both riding
 * surfaces ask rideView() once, and after that only a failure, the rider's
 * Flat road or "Try 3D again" moves it — never reduced motion switched on
 * mid-ride, never a second that drew well again. Loads no three.js.
 */
import { prefersReducedMotion } from '$lib/motion';
import { WORLD_MIN_PX } from '$lib/session/docks';
import { worldSlotOn } from './flag';
import {
	rideView,
	type Failure,
	type RideView,
	type SkylineReason,
} from './ride-view';

const FLAT_KEY = 'wattroom.flat-road.v1';

// The window's height, kept for every ride on the page by one listener.
const viewport = $state({
	height: typeof window === 'undefined' ? Infinity : window.innerHeight,
});
if (typeof window !== 'undefined')
	window.addEventListener(
		'resize',
		() => (viewport.height = window.innerHeight),
	);

/** The rider's Flat road choice on this device; null while never made. */
export function flatRoad(): boolean | null {
	try {
		const v = localStorage.getItem(FLAT_KEY);
		return v === null ? null : v === '1';
	} catch {
		return null;
	}
}

export function setFlatRoad(flat: boolean): void {
	try {
		localStorage.setItem(FLAT_KEY, flat ? '1' : '0');
	} catch {
		/* a browser that keeps nothing keeps the default */
	}
}

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
	const decide = (): RideView | null =>
		worldSlotOn()
			? rideView({
					flat: flatRoad(),
					reducedMotion: prefersReducedMotion.current,
					...capabilities(),
					failure,
				})
			: null;
	let view = $state<RideView | null>(decide());
	// The window's height is live, unlike a failure: the world comes back
	// the moment the window holds its panels again.
	const shown = (): RideView | null =>
		view === 'world' && viewport.height < WORLD_MIN_PX
			? { skyline: 'short' }
			: view;
	const reason = (): SkylineReason | null => {
		const v = shown();
		return v === null || v === 'world' ? null : v.skyline;
	};
	return {
		/** The world draws in slot 2. */
		get on() {
			return shown() === 'world';
		},
		/** Why this ride is on the Skyline; null in the world, or where this device has no world slot. */
		get reason() {
			return reason();
		},
		fail(why: Failure) {
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
		/** The world's context menu: the flat road, from now on, on this device. */
		flatten() {
			setFlatRoad(true);
			view = decide();
		},
		/** The only way back to the world this ride; a choice it overrides is the rider's new one. */
		retry() {
			const was = reason();
			if (was === 'chosen' || was === 'motion') setFlatRoad(false);
			failure = null;
			view = decide();
		},
	};
}
