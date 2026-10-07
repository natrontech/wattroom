/**
 * Which view a ride on a road gets (#3080, ADR-0066): the world, or the
 * Skyline and why. Pure; the caller holds the answer for the rest of the
 * ride — the fallback is one-way, and "Try 3D again" is the only way back.
 * The World control is read first (ADR-0079: reduced motion opens on Flat),
 * then what the browser can do, then what the world did this ride. Width is
 * no input: a phone with Web Bluetooth rides (ADR-0066).
 */

/** Why a world that started stopped: its context lost, its build or shaders failed, its frames missed. */
export type Failure = 'context-lost' | 'build-failed' | 'frames';

/** `short`: the window is too short for the panels around the road (Jan, 2026-10-07, #3668). */
export type SkylineReason =
	'chosen' | 'motion' | 'capability' | 'short' | Failure;

export type RideViewEnv = {
	/** The rider's Flat road choice on this device; null while never made. */
	flat: boolean | null;
	reducedMotion: boolean;
	webgl2: boolean;
	/** WEBGL_multi_draw: the renderer's batches are one draw only with it. */
	multiDraw: boolean;
	/** What stopped the world this ride, if anything did. */
	failure: Failure | null;
};

export type RideView = 'world' | { skyline: SkylineReason };

export function rideView(env: RideViewEnv): RideView {
	if (env.flat === true) return { skyline: 'chosen' };
	if (env.flat === null && env.reducedMotion) return { skyline: 'motion' };
	if (!env.webgl2 || !env.multiDraw) return { skyline: 'capability' };
	if (env.failure) return { skyline: env.failure };
	return 'world';
}

/**
 * The persistent line in slot 1 (errors.md: a ride-critical state is status,
 * never a toast): what happened, and whether "Try 3D again" can mend it — a
 * browser that cannot draw the world gets no button that would fail.
 */
export const REASONS: Record<SkylineReason, { line: string; retry: boolean }> =
	{
		chosen: { line: 'Flat road — as you set it on this device', retry: true },
		motion: {
			line: 'Flat road — this device asks for reduced motion',
			retry: true,
		},
		capability: {
			line: 'Flat road — this browser cannot draw the world; another browser may',
			retry: false,
		},
		'context-lost': {
			line: 'Flat road — the graphics driver let the world go',
			retry: true,
		},
		'build-failed': {
			line: 'Flat road — the world did not build',
			retry: true,
		},
		frames: { line: 'Flat road — this screen dropped frames', retry: true },
		// It comes back by itself when the window grows: nothing to press.
		short: {
			line: 'Flat road — this window is too short for the world',
			retry: false,
		},
	};
