import { describe, expect, it } from 'vitest';
import { createBunch, formation, LANE, PULL_LANE } from './bunch';
import type { BunchView } from '$lib/channel/bunch-view';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

describe('formation (#3098)', () => {
	it('rides two abreast, centred on the road and on the bunch', () => {
		const f = formation(['a', 'b'], 0);
		expect(f.get('a')).toEqual({ lane: LANE / 2, ahead: 0 });
		expect(f.get('b')).toEqual({ lane: -LANE / 2, ahead: 0 });
	});

	it('fills rows of docs/SPEC.md’s lanes from the front, in joining order', () => {
		const f = formation(ids(8), 0);
		const front = [0, 1, 2, 3].map((i) => f.get(`r${i}`)!);
		const back = [4, 5, 6, 7].map((i) => f.get(`r${i}`)!);
		expect(new Set(front.map((s) => s.ahead)).size).toBe(1);
		expect(front[0].ahead).toBeGreaterThan(back[0].ahead);
		// Centred: the rows straddle the bunch's metre.
		expect(front[0].ahead).toBeCloseTo(-back[0].ahead);
		expect(front.map((s) => s.lane)).toEqual(
			[1.5, 0.5, -0.5, -1.5].map((k) => k * LANE),
		);
	});

	it('centres a short last row, where a late joiner rides in', () => {
		const f = formation(ids(7), 0);
		expect(f.get('r6')).toEqual({ lane: -LANE, ahead: f.get('r4')!.ahead });
		expect(f.get('r5')!.lane).toBe(0);
		expect(f.get('r6')!.ahead).toBeLessThan(f.get('r0')!.ahead);
	});

	it('turns the front row to the back every 120 s of elapsed time', () => {
		const start = formation(ids(12), 0);
		const turned = formation(ids(12), 120);
		const again = formation(ids(12), 240);
		// Three rows of four: the front row is now last, everyone else moved up one.
		expect(turned.get('r0')!.ahead).toBe(start.get('r8')!.ahead);
		expect(turned.get('r4')!.ahead).toBe(start.get('r0')!.ahead);
		expect(turned.get('r8')!.ahead).toBe(start.get('r4')!.ahead);
		expect(again.get('r0')!.ahead).toBe(start.get('r4')!.ahead);
		expect(formation(ids(12), 360)).toEqual(start);
		// Lanes are kept: a row turns as a row.
		expect(turned.get('r1')!.lane).toBe(start.get('r1')!.lane);
		expect(formation(ids(12), 119)).toEqual(start);
	});
});

const there = (...ids: string[]) =>
	new Map(ids.map((id) => [id, { watts: 200, ftp: 250 }]));

function view(over: Partial<BunchView> = {}): BunchView {
	return {
		m: 1000,
		mps: 8,
		elapsed: 30,
		order: ['a', 'b'],
		offsets: {},
		resting: [],
		present: there('a', 'b', 'c', 'coach'),
		game: false,
		cheered: [],
		...over,
	};
}

/** Steps `s` seconds of 30 fps frames; `tick` gives the view at each frame's time from now. */
function ride(
	bunch: ReturnType<typeof createBunch>,
	s: number,
	tick: (t: number) => BunchView,
) {
	let out = bunch.step(tick(0), 0);
	for (let k = 1; k <= Math.round(s * 30); k++)
		out = bunch.step(tick(k / 30), 1 / 30);
	return out;
}

const of = (
	out: ReturnType<ReturnType<typeof createBunch>['step']>,
	id: string,
) => out.riders.find((r) => r.id === id)!;

describe('the bunch between ticks (#3098)', () => {
	it('rolls on at the bunch’s speed while the ticks stay away', () => {
		const bunch = createBunch();
		const out = ride(bunch, 3, () => view());
		expect(of(out, 'a').d).toBeCloseTo(1000 + 8 * 3, 0);
		expect(of(out, 'a').alpha).toBe(1);
	});

	it('eases onto a new place near by, and dithers to one far off', () => {
		const near = createBunch();
		ride(near, 1, () => view());
		const step = near.step(view({ m: 1018 }), 1 / 30);
		expect(of(step, 'a').d).toBeLessThan(1015);
		expect(of(step, 'a').alpha).toBe(1);

		const far = createBunch();
		ride(far, 1, () => view());
		// 60 m off: out in 200 ms, still rolling, then in at the right place.
		const out = ride(far, 0.15, (t) => view({ m: 1068 + 8 * t }));
		expect(of(out, 'a').alpha).toBeLessThan(0.5);
		expect(of(out, 'a').d).toBeLessThan(1020);
		const landed = ride(far, 0.6, (t) => view({ m: 1069.2 + 8 * t }));
		expect(of(landed, 'a').alpha).toBe(1);
		expect(of(landed, 'a').d).toBeCloseTo(1069.2 + 8 * 0.6, 0);
	});

	it('dithers a late joiner in at the back', () => {
		const order = ['a', 'b', 'c'];
		const bunch = createBunch();
		ride(bunch, 1, () => view({ order }));
		const joined = bunch.step(view({ order: [...order, 'e'] }), 1 / 30);
		expect(of(joined, 'e').alpha).toBeLessThan(0.2);
		const settled = ride(bunch, 2, () => view({ order: [...order, 'e'] }));
		expect(of(settled, 'e').alpha).toBe(1);
		for (const id of order)
			expect(of(settled, 'e').d).toBeLessThan(of(settled, id).d);
	});

	it('pulls a resting rider over, and the team car tows them back beside it', () => {
		const bunch = createBunch();
		const rest = ride(bunch, 3, () =>
			view({ resting: ['b'], offsets: { b: -30 } }),
		);
		expect(of(rest, 'b').lane).toBeCloseTo(PULL_LANE, 1);
		expect(rest.car).toBeNull();
		const towed = ride(bunch, 1, () => view({ offsets: { b: -28 } }));
		expect(towed.car).not.toBeNull();
		expect(towed.car!.d).toBeCloseTo(of(towed, 'b').d, 0);
		expect(towed.car!.lane).toBeGreaterThan(of(towed, 'b').lane);
		// docs/SPEC.md's 20 s tow: still towing at 19 s, the rider on the shoulder beside the car.
		const towing = ride(bunch, 18, () => view({ offsets: { b: -2 } }));
		expect(towing.car).not.toBeNull();
		expect(of(towing, 'b').lane).toBeCloseTo(PULL_LANE, 1);
		// The tow over, the car leaves and the rider takes their place.
		const back = ride(bunch, 5, () => view());
		expect(back.car).toBeNull();
		expect(of(back, 'b').lane).toBeCloseTo(-LANE / 2, 1);
	});

	it('never runs the team car in a game', () => {
		const bunch = createBunch();
		ride(bunch, 1, () => view({ game: true, resting: ['b'] }));
		expect(ride(bunch, 1, () => view({ game: true })).car).toBeNull();
	});

	it('puts a coach with no trainer in the team car, behind the bunch, wearing the chevron', () => {
		const bunch = createBunch();
		const out = ride(bunch, 1, () =>
			view({ order: ['coach', 'a', 'b'], coach: 'coach', resting: ['coach'] }),
		);
		expect(out.riders.map((r) => r.id)).toEqual(['a', 'b']);
		expect(out.car).toMatchObject({ coach: true, alpha: 1 });
		expect(out.car!.d).toBeLessThan(of(out, 'a').d - 4);
		// A coach on a trainer rides in the bunch, chevron and all.
		const riding = createBunch();
		const rode = ride(riding, 1, () =>
			view({ order: ['coach', 'a'], coach: 'coach' }),
		);
		expect(of(rode, 'coach').coach).toBe(true);
		expect(rode.car).toBeNull();
	});

	it('fades a rider whose screen has gone, and lets a rider who left dither out', () => {
		const bunch = createBunch();
		const faded = ride(bunch, 1, () => view({ present: there('a') }));
		expect(of(faded, 'b').faded).toBe(true);
		expect(of(faded, 'a').faded).toBe(false);
		const left = ride(bunch, 0.5, () => view({ order: ['a'] }));
		expect(left.riders.map((r) => r.id)).toEqual(['a']);
	});

	it('never lets two riders in one lane ride through each other', () => {
		const bunch = createBunch();
		const order = ids(8);
		// r4 rides behind r0 in the same lane, then moves up 3 m on its offset.
		const out = ride(bunch, 4, () => view({ order, offsets: { r4: 3 } }));
		const a = of(out, 'r0');
		const b = of(out, 'r4');
		// Within a bike of each other, never closer across than a handlebar.
		expect(Math.abs(a.d - b.d)).toBeLessThan(1.7);
		expect(Math.abs(a.lane - b.lane)).toBeGreaterThan(0.42);
	});

	it('carries a tick handled late on from when the hub sent it', () => {
		// Ticks sent each second; this page took 50 ms for most, then 3 s for one.
		const bunch = createBunch();
		bunch.step(view({ m: 1000, at: 0 }), 0, 50);
		bunch.step(view({ m: 1008, at: 1000 }), 1, 1050);
		bunch.step(view({ m: 1016, at: 2000 }), 4, 5050);
		// Two seconds on with no tick: the bunch has ridden 3 s past that one and 2 more.
		let out = bunch.step(view({ m: 1016, at: 2000 }), 0, 5050);
		for (let k = 0; k < 60; k++)
			out = bunch.step(view({ m: 1016, at: 2000 }), 1 / 30, 5050 + k * 33);
		expect(of(out, 'a').d).toBeCloseTo(1016 + 5 * 8, 0);
	});

	it('lays the same bunch out whatever this screen saw first (#3098)', () => {
		// One screen saw the coach ride alone, then a late joiner a metre behind;
		// another opened with both there. Both end with the two in their slots.
		const late = createBunch();
		ride(late, 0.5, () => view({ order: ['a'] }));
		const seen = ride(late, 3, () =>
			view({ order: ['a', 'b'], offsets: { b: -1 } }),
		);
		const fresh = ride(createBunch(), 3, () =>
			view({ order: ['a', 'b'], offsets: { b: -1 } }),
		);
		for (const id of ['a', 'b'])
			expect(of(seen, id).lane).toBeCloseTo(of(fresh, id).lane, 2);
		expect(of(seen, 'b').lane).toBeCloseTo(-LANE / 2, 2);
	});
});
