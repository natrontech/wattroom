import { describe, expect, it } from 'vitest';
import { hairpinClimb } from '$lib/road/fixtures';
import { toRoute } from '$lib/road/route';
import { indexStroke } from '../chunks/stroke-index';
import type { Salt } from '../place/keyed';
import { onStroke, type Keying } from '../place/region';
import { strokeOf } from '../place/stroke';
import { relief } from './ground';
import { BLEND_M, regionPoints } from './region-relief';

const WORLD: Salt = [1, 1, 2, 3];
const OWN: Salt = [34, 55, 89, 144];
const road = toRoute(hairpinClimb()).road;
const stroke = strokeOf({ h: 'h', road });
const FROM = 400;
const TO = 900;
const keying: Keying = {
	stroke,
	salt: WORLD,
	regions: [
		onStroke(stroke, {
			fromM: road.length - TO,
			toM: road.length - FROM,
			salt: OWN,
		}),
	],
};
const regions = regionPoints(keying, indexStroke(stroke));
const SIZES = [40, 80];
const inside = relief(WORLD, [0, 0], regions);
const publicly = relief(WORLD);

/** The spot `offset` m right of the stroke at `along`, as the ground is asked for it. */
function spot(along: number, offset: number): [number, number] {
	const i = Math.round((along - stroke.startM) / 2);
	const p = stroke.points;
	const dx = p[2 * i + 2] - p[2 * i];
	const dz = p[2 * i + 3] - p[2 * i + 1];
	const len = Math.hypot(dx, dz);
	return [p[2 * i] - (dz / len) * offset, p[2 * i + 1] + (dx / len) * offset];
}
/** The ground's local z runs south where the key frame's n runs north. */
const flip = ([e, n]: [number, number]): [number, number] => [e, -n];
const at = (f: typeof inside, along: number, offset = 10) =>
	f('ground', SIZES, ...flip(spot(along, offset)));

describe('a private region’s relief (#3607)', () => {
	const deep = (FROM + TO) / 2;

	it('differs from the public ground deep inside and is the public ground outside', () => {
		expect(at(inside, deep)).not.toBe(at(publicly, deep));
		expect(at(inside, FROM - 20)).toBe(at(publicly, FROM - 20));
		expect(at(inside, TO + 20)).toBe(at(publicly, TO + 20));
	});

	it('is keyed by the region’s secret, in the region’s cells', () => {
		const other = relief(
			WORLD,
			[0, 0],
			regionPoints(
				{
					...keying,
					regions: [
						onStroke(stroke, {
							fromM: road.length - TO,
							toM: road.length - FROM,
							salt: WORLD,
						}),
					],
				},
				indexStroke(stroke),
			),
		);
		// the world's own secret in region cells is not what the owner's is
		expect(at(other, deep)).not.toBe(at(inside, deep));
		const p = regions(...spot(deep, 10))!;
		expect(p.w).toBe(1);
		// 250 m on from the region's origin, 10 m beside it: the frame, not the world's metres.
		expect(p.u).toBeCloseTo(TO - deep, 0);
		expect(p.v).toBeCloseTo(-10, 0);

		const own = relief(OWN, [0, 0], () => null);
		// The region's value is the plain noise of its secret at (u, v): no world coordinate.
		const direct = relief(OWN, [0, 0]);
		expect(at(inside, deep)).toBe(direct('ground', SIZES, p.u, -p.v));
		expect(own).toBeTypeOf('function');
	});

	it('meets the public ground at the edge without a step', () => {
		// The largest change over 0.5 m across an edge and its blend, beside the public ground's over the same road.
		const jump = (f: typeof inside, edge: number) => {
			let w = 0;
			for (let a = edge - 30; a < edge + BLEND_M + 30; a += 0.5)
				w = Math.max(w, Math.abs(at(f, a + 0.5) - at(f, a)));
			return w;
		};
		for (const edge of [FROM, TO - BLEND_M])
			expect(jump(inside, edge)).toBeLessThan(jump(publicly, edge) * 3);
	});
});
