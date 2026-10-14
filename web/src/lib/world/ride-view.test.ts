import { describe, expect, it } from 'vitest';
import { rideView, type RideView, type RideViewEnv } from './ride-view';

const able: RideViewEnv = {
	mode: null,
	reducedMotion: false,
	webgl2: true,
	multiDraw: true,
	failure: null,
};

describe('rideView (#3080)', () => {
	const cases: [string, Partial<RideViewEnv>, RideView][] = [
		['a capable browser, nothing chosen', {}, 'world'],
		['the rider chose Flat road', { mode: 'flat' }, { skyline: 'chosen' }],
		[
			'reduced motion opens on Flat',
			{ reducedMotion: true },
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
		// The World control is read first, then the browser, then the ride.
		[
			'a choice outranks a missing capability',
			{ mode: 'flat', webgl2: false },
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
