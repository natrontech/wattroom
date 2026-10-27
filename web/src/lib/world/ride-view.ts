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

/**
 * Why the ride is on the Skyline, for the view switch (#4217, ADR-0091):
 * `line` is the whole sentence, the switch's status for a screen reader and
 * the 3D segment's tooltip (errors.md: a ride-critical state is status,
 * never a toast); `short` the few words on the 3D segment itself; `retry`
 * whether a tap on 3D can bring the world back. A browser that cannot draw
 * it, or a window too short for it, gets a 3D segment that would fail:
 * disabled, its words the hint.
 */
export const REASONS: Record<
	SkylineReason,
	{ line: string; short: string | null; retry: boolean }
> = {
	chosen: {
		line: 'Flat road — switch to 3D here or in Settings → Appearance',
		short: null,
		retry: true,
	},
	motion: {
		line: 'Flat road — reduced motion is on',
		short: 'steady camera',
		retry: true,
	},
	capability: {
		line: 'Flat road — this browser cannot draw 3D; another browser may',
		short: 'not in this browser',
		retry: false,
	},
	'context-lost': {
		line: 'Flat road — the graphics driver let the world go',
		short: 'graphics lost',
		retry: true,
	},
	'build-failed': {
		line: 'Flat road — the world did not build',
		short: 'did not build',
		retry: true,
	},
	frames: {
		line: 'Flat road — this screen dropped frames',
		short: 'dropped frames',
		retry: true,
	},
	// It comes back by itself when the window grows: nothing to press.
	short: {
		line: 'Flat road — this window is too short for the world',
		short: 'window too short',
		retry: false,
	},
};

/** The view switch's three segments (#4217): the horizon's two views and the computer's MAP. */
export type ViewSegment = '3d' | 'flat' | 'map';

/**
 * What the view switch shows: the pressed segment, which is where the rider
 * is looking (MAP on the computer outranks the horizon), and whether its 3D
 * segment can do anything.
 */
export function viewSwitch(s: {
	/** The world draws on this screen. */
	world: boolean;
	/** Why it does not; null while it does. */
	reason: SkylineReason | null;
	/** The computer shows its MAP page. */
	onMap: boolean;
}): { pressed: ViewSegment; worldOffered: boolean } {
	return {
		pressed: s.onMap ? 'map' : s.world ? '3d' : 'flat',
		worldOffered: s.world || (s.reason !== null && REASONS[s.reason].retry),
	};
}

/**
 * Asks the riding screen's view switch to flip between 3D and Flat: the
 * phone remote's 3D / Flat (#4223). From MAP it goes to 3D, as its 3D
 * segment does. Says whether a switch took it: none where no world can draw.
 */
export const VIEW_ASK = 'wattroom:view-flip';

export function askViewFlip(): boolean {
	return !window.dispatchEvent(new Event(VIEW_ASK, { cancelable: true }));
}

/** The segment a flip asks for, or null where 3D cannot be tried. */
export function flipped(s: {
	pressed: ViewSegment;
	worldOffered: boolean;
}): '3d' | 'flat' | null {
	if (s.pressed === '3d') return 'flat';
	return s.worldOffered ? '3d' : null;
}
