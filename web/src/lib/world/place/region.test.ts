import { describe, expect, it } from 'vitest';
import { hairpinClimb } from '$lib/road/fixtures';
import { toRoute } from '$lib/road/route';
import type { Road } from '$lib/road/road';
import type { Salt } from './keyed';
import { FINE_M } from './lattice';
import { keyAt, onStroke, type Keying } from './region';
import { strokeMetre, strokeOf } from './stroke';

const ROAD_SALT: Salt = [1, 1, 2, 3];
const OTHER_ROAD_SALT: Salt = [5, 8, 13, 21];
const HOME_SALT: Salt = [34, 55, 89, 144];
const HIDDEN_M = 400;

const route = toRoute(hairpinClimb());

function keyingOf(road: Road, salt: Salt): Keying {
	const stroke = strokeOf({ h: 'h', road });
	return {
		stroke,
		salt,
		regions: [
			onStroke(stroke, { fromM: 0, toM: HIDDEN_M, salt: HOME_SALT }),
			onStroke(stroke, {
				fromM: road.length - HIDDEN_M,
				toM: road.length,
				salt: HOME_SALT,
			}),
		],
	};
}

/** Every fine spot within 40 m of the road as served, from `from` to `to` metres along it. */
function spots(from: number, to: number): [number, number][] {
	const out: [number, number][] = [];
	for (let along = from; along < to; along += FINE_M)
		for (let offset = -40; offset <= 40; offset += FINE_M)
			out.push([along, offset]);
	return out;
}

/** Each spot's key, found on the stroke however the stroke happens to run. */
const keysAt = (keying: Keying, where: [number, number][]) =>
	where.map(([along, offset]) =>
		keyAt(
			keying,
			'tree',
			strokeMetre(keying.stroke, along),
			keying.stroke.reversed ? -offset : offset,
			FINE_M,
		),
	);

describe('a private region', () => {
	const inside = spots(0, HIDDEN_M);
	const outside = spots(
		HIDDEN_M + FINE_M,
		route.road.length - HIDDEN_M - FINE_M,
	);

	it('never reads a world coordinate or the road inside it', () => {
		const keying = keyingOf(route.road, ROAD_SALT);
		// A stroke with no geometry at all: any spot keyed by its world
		// position has nothing to be keyed by.
		const blind: Keying = {
			...keying,
			stroke: {
				...keying.stroke,
				points: keying.stroke.points.map(() => Number.NaN),
			},
		};
		expect(keysAt(blind, inside)).toEqual(keysAt(keying, inside));
		expect(() => keysAt(blind, outside.slice(0, 1))).toThrow();
	});

	it('changes nothing inside when the map inside it changes', () => {
		// The first 400 m of the road bent another way.
		const bent: Road = {
			...route.road,
			turns: route.road.turns.map((t, i) => (i * 20 < HIDDEN_M ? t + 7 : t)),
		};
		expect(keysAt(keyingOf(bent, ROAD_SALT), inside)).toEqual(
			keysAt(keyingOf(route.road, ROAD_SALT), inside),
		);
	});

	it('keys inside with its own salt, never the road’s', () => {
		expect(keysAt(keyingOf(route.road, OTHER_ROAD_SALT), inside)).toEqual(
			keysAt(keyingOf(route.road, ROAD_SALT), inside),
		);
		// Outside, the road's salt is the whole key.
		expect(keysAt(keyingOf(route.road, OTHER_ROAD_SALT), outside)).not.toEqual(
			keysAt(keyingOf(route.road, ROAD_SALT), outside),
		);
	});
});
