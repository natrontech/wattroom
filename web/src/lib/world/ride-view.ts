/**
 * Which view a ride on a road gets (#3080, ADR-0066): the world, or the
 * Skyline and why. Pure; the caller holds the answer for the rest of the
 * ride — the fallback is one-way, and the reason's button is the only way
 * back. What the browser can do is read first, so a browser that cannot draw
 * the world never offers it; then the World control, which opens on Flat
 * until the rider turns 3D on (#3084, ADR-0066 amended); then what the world
 * did this ride. Width is no input: a phone with Web Bluetooth rides.
 */

import type { WorldMode } from './mode';

/** Why a world that started stopped: its context lost, its build or shaders failed, its frames missed. */
export type Failure = 'context-lost' | 'build-failed' | 'frames';

/** `short`: the window is too short for the panels around the road (Jan, 2026-10-07, #3668). */
/** `chosen`: the World control is on Flat, or was never set, which is Flat. */
export type SkylineReason =
	'chosen' | 'motion' | 'capability' | 'short' | Failure;

export type RideViewEnv = {
	/** The rider's World control on this device; null while never chosen. */
	mode: WorldMode | null;
	reducedMotion: boolean;
	webgl2: boolean;
	/** WEBGL_multi_draw: the renderer's batches are one draw only with it. */
	multiDraw: boolean;
	/** What stopped the world this ride, if anything did. */
	failure: Failure | null;
};

export type RideView = 'world' | { skyline: SkylineReason };

export function rideView(env: RideViewEnv): RideView {
	if (!env.webgl2 || !env.multiDraw) return { skyline: 'capability' };
	if (env.mode === null && env.reducedMotion) return { skyline: 'motion' };
	if (env.mode === null || env.mode === 'flat') return { skyline: 'chosen' };
	if (env.failure) return { skyline: env.failure };
	return 'world';
}

/** Reduced motion's one tap back into the world (ADR-0079): it sets Steady. */
export const STEADY_BUTTON = 'Show the world (steady camera)';

/** The rider's one tap from the flat road into 3D (#3084): it sets Full. */
export const RIDE_3D = 'Ride in 3D';

const TRY_AGAIN = 'Try 3D again';

/**
 * The persistent line in slot 1 (errors.md: a ride-critical state is status,
 * never a toast): what happened, and the button that mends it, if one can — a
 * browser that cannot draw the world gets no button that would fail.
 */
export const REASONS: Record<
	SkylineReason,
	{ line: string; button: string | null }
> = {
	chosen: {
		line: 'Flat road — switch to 3D here or in Settings → Appearance',
		button: RIDE_3D,
	},
	motion: { line: 'Flat road — reduced motion is on', button: STEADY_BUTTON },
	capability: {
		line: 'Flat road — this browser cannot draw 3D; another browser may',
		button: null,
	},
	'context-lost': {
		line: 'Flat road — the graphics driver let the world go',
		button: TRY_AGAIN,
	},
	'build-failed': {
		line: 'Flat road — the world did not build',
		button: TRY_AGAIN,
	},
	frames: { line: 'Flat road — this screen dropped frames', button: TRY_AGAIN },
	// It comes back by itself when the window grows: nothing to press.
	short: {
		line: 'Flat road — this window is too short for the world',
		button: null,
	},
};
