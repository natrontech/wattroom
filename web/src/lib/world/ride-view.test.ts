import { describe, expect, it } from 'vitest';
import {
	flipped,
	nextSegment,
	offeredSegments,
	press,
	REASONS,
	rideView,
	viewSwitch,
	type RideView,
	type RideViewEnv,
} from './ride-view';

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
		// The bike opens the world: Flat is a choice, or a machine's limit.
		['nothing chosen rides the world', { mode: null }, 'world'],
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

/**
 * The view switch (#4217, ADR-0091): pressed is where the rider looks, and
 * 3D is offered wherever a tap there can bring the world back. A rider whose
 * world fell back found no way back from a line at label size.
 */
describe('viewSwitch', () => {
	it('presses Room over every other view while the ride looks at the room', () => {
		expect(
			viewSwitch({ world: true, reason: null, onMap: true, inRoom: true })
				.pressed,
		).toBe('room');
	});

	const cases: [
		string,
		Parameters<typeof viewSwitch>[0],
		ReturnType<typeof viewSwitch>,
	][] = [
		[
			'in the world',
			{ world: true, reason: null, onMap: false },
			{ pressed: '3d', worldOffered: true },
		],
		[
			'flat by choice',
			{ world: false, reason: 'chosen', onMap: false },
			{ pressed: 'flat', worldOffered: true },
		],
		[
			'flat after dropped frames',
			{ world: false, reason: 'frames', onMap: false },
			{ pressed: 'flat', worldOffered: true },
		],
		[
			'flat under reduced motion',
			{ world: false, reason: 'motion', onMap: false },
			{ pressed: 'flat', worldOffered: true },
		],
		[
			'flat in a browser with no WebGL',
			{ world: false, reason: 'capability', onMap: false },
			{ pressed: 'flat', worldOffered: false },
		],
		[
			'flat in a window too short',
			{ world: false, reason: 'short', onMap: false },
			{ pressed: 'flat', worldOffered: false },
		],
		[
			'on MAP over the world',
			{ world: true, reason: null, onMap: true },
			{ pressed: 'map', worldOffered: true },
		],
		[
			'on MAP over the flat road',
			{ world: false, reason: 'chosen', onMap: true },
			{ pressed: 'map', worldOffered: true },
		],
	];
	for (const [name, state, want] of cases)
		it(name, () => expect(viewSwitch(state)).toEqual(want));

	it('gives every reason but the rider’s own choice its few words', () => {
		for (const [reason, { short }] of Object.entries(REASONS))
			if (reason === 'chosen') expect(short).toBeNull();
			else expect(short, reason).toBeTruthy();
	});
});

describe('press (#4535)', () => {
	it('leaves MAP for every other segment, so Lounge from Map is one press', () => {
		expect(press('room', true)).toEqual({ room: true, page: 'ride' });
		expect(press('3d', true)).toEqual({ room: false, page: 'ride' });
		expect(press('flat', true)).toEqual({ room: false, page: 'ride' });
	});

	it('leaves the room for every other segment', () => {
		expect(press('map', false)).toEqual({ room: false, page: 'map' });
		expect(press('3d', false)).toEqual({ room: false, page: null });
		expect(press('flat', false)).toEqual({ room: false, page: null });
	});

	it('turns no page off MAP', () => {
		expect(press('room', false)).toEqual({ room: true, page: null });
	});
});

describe('the phone remote’s 3D / Flat (#4223)', () => {
	it('flips 3D to Flat, and Flat or MAP to 3D where 3D can be tried', () => {
		expect(flipped({ pressed: '3d', worldOffered: true })).toBe('flat');
		expect(flipped({ pressed: 'flat', worldOffered: true })).toBe('3d');
		expect(flipped({ pressed: 'map', worldOffered: true })).toBe('3d');
	});

	it('asks nothing where no world can draw', () => {
		expect(flipped({ pressed: 'flat', worldOffered: false })).toBeNull();
		expect(flipped({ pressed: 'map', worldOffered: false })).toBeNull();
	});
});

describe('the view switch’s segments, in order (#4532)', () => {
	const all = { road: true, worldOffered: true, maps: true, roomy: true };

	it('draws 3D, Flat, Map and Lounge in that order', () => {
		expect(offeredSegments(all)).toEqual(['3d', 'flat', 'map', 'room']);
	});

	it('leaves out 3D where the world cannot be tried, Map with no MAP page, Lounge out of a voice channel', () => {
		expect(offeredSegments({ ...all, worldOffered: false })).toEqual([
			'flat',
			'map',
			'room',
		]);
		expect(offeredSegments({ ...all, maps: false })).toEqual([
			'3d',
			'flat',
			'room',
		]);
		expect(offeredSegments({ ...all, roomy: false })).toEqual([
			'3d',
			'flat',
			'map',
		]);
	});

	it('offers Flat and Lounge off a road, and nothing with neither', () => {
		expect(offeredSegments({ ...all, road: false })).toEqual([
			'flat',
			'map',
			'room',
		]);
		expect(offeredSegments({ ...all, road: false, roomy: false })).toEqual([]);
	});
});

describe('a controller’s Menu: the next segment (#4532)', () => {
	const every = ['3d', 'flat', 'map', 'room'] as const;
	const solo = ['3d', 'flat', 'map'] as const;
	const noWorld = ['flat', 'map', 'room'] as const;

	it.each([
		['3d', every, 'flat'],
		['flat', every, 'map'],
		['map', every, 'room'],
		['room', every, '3d'],
		['3d', solo, 'flat'],
		['flat', solo, 'map'],
		['map', solo, '3d'],
		['flat', noWorld, 'map'],
		['map', noWorld, 'room'],
		['room', noWorld, 'flat'],
		['flat', ['flat', 'map'], 'map'],
		['map', ['flat', 'map'], 'flat'],
	] as const)('goes from %s through %j to %s', (from, offered, to) => {
		expect(nextSegment(from, offered)).toBe(to);
	});

	it('starts again at the first where the pressed segment went away', () => {
		expect(nextSegment('room', solo)).toBe('3d');
		expect(nextSegment('3d', noWorld)).toBe('flat');
	});

	it('moves nowhere with one segment or none', () => {
		expect(nextSegment('flat', ['flat'])).toBeNull();
		expect(nextSegment('flat', [])).toBeNull();
	});
});
