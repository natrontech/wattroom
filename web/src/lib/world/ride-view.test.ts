import { describe, expect, it } from 'vitest';
import { rideView, type RideView, type RideViewEnv } from './ride-view';

/** A capable browser whose rider turned 3D on. */
const able: RideViewEnv = {
	mode: 'full',
	reducedMotion: false,
	webgl2: true,
	multiDraw: true,
	failure: null,
};

describe('rideView (#3080)', () => {
	const cases: [string, Partial<RideViewEnv>, RideView][] = [
		['the rider turned 3D on', {}, 'world'],
		// 3D is opt-in (#3084, ADR-0066 amended): never chosen is Flat.
		['nothing chosen rides Flat', { mode: null }, { skyline: 'chosen' }],
		['the rider chose Flat road', { mode: 'flat' }, { skyline: 'chosen' }],
		[
			'reduced motion, nothing chosen, opens on Flat with Steady one tap away',
			{ mode: null, reducedMotion: true },
			{ skyline: 'motion' },
		],
		[
			'reduced motion, the rider chose 3D',
			{ reducedMotion: true, mode: 'full' },
			'world',
		],
		[
			'reduced motion, the rider chose Steady',
			{ reducedMotion: true, mode: 'steady' },
			'world',
		],
		[
			'reduced motion, the rider chose Flat',
			{ reducedMotion: true, mode: 'flat' },
			{ skyline: 'chosen' },
		],
		['Light is a world', { mode: 'light' }, 'world'],
		['no WebGL2', { webgl2: false }, { skyline: 'capability' }],
		['no WEBGL_multi_draw', { multiDraw: false }, { skyline: 'capability' }],
		[
			'a lost context',
			{ failure: 'context-lost' },
			{ skyline: 'context-lost' },
		],
		[
			'a world that did not build',
			{ failure: 'build-failed' },
			{ skyline: 'build-failed' },
		],
		['missed frames', { failure: 'frames' }, { skyline: 'frames' }],
		// The browser is read first, so a browser that cannot draw the world
		// never offers it; then the World control; then the ride.
		[
			'a missing capability outranks Flat, so no 3D button would fail',
			{ mode: 'flat', webgl2: false },
			{ skyline: 'capability' },
		],
		[
			'a missing capability outranks nothing chosen',
			{ mode: null, multiDraw: false },
			{ skyline: 'capability' },
		],
		[
			'Flat outranks a failure',
			{ mode: 'flat', failure: 'frames' },
			{ skyline: 'chosen' },
		],
		[
			'a missing capability outranks a failure',
			{ multiDraw: false, failure: 'frames' },
			{ skyline: 'capability' },
		],
		[
			'the rider chose 3D and the frames failed',
			{ mode: 'full', failure: 'frames' },
			{ skyline: 'frames' },
		],
	];
	for (const [name, env, view] of cases)
		it(name, () => expect(rideView({ ...able, ...env })).toEqual(view));
});
