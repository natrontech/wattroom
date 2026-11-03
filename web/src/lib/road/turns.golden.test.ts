import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_ROADS } from '$lib/ride/home-roads';
import { syntheticPoints } from '$lib/world/synthetic';
import { bridgeAndTunnel, hairpinClimb, switchback } from './fixtures';
import { frameOf, project } from './line';
import { turnsOf } from './profile';
import { decodePolyline6 } from './road';
import { toRoute } from './route';

/**
 * A route's turns rebuilt from its own sealed line (#4383's follow-up): the
 * server straightens a road imported before #4379 from the shape it keeps,
 * as road.TurnsOfShape, and these vectors hold it to the browser's turnsOf
 * over the same line. Every fixture is invented. Rewrite with
 * `UPDATE_GOLDEN=1 pnpm exec vitest run src/lib/road/turns.golden.test.ts`.
 */
const PATH = new URL(
	'../../../../server/internal/road/testdata/turns-golden.json',
	import.meta.url,
);

/** The turns of the line a shape keeps, every second sample as a road stores them. */
export function turnsOfShape(shape: string): number[] {
	const points = decodePolyline6(shape).map((p) => ({ ...p, ele: 0 }));
	const { x, z } = project(points, frameOf(points));
	return turnsOf(Float64Array.from(x), Float64Array.from(z), 2);
}

async function vectors() {
	const shapes = await Promise.all(HOME_ROADS.map((r) => r.shape()));
	const fixtures = [
		['the 21-hairpin climb', hairpinClimb()],
		['the switchback', switchback()],
		['the road under the bridge and tunnel', bridgeAndTunnel()],
		...HOME_ROADS.map((r, i) => [r.name, syntheticPoints(shapes[i])] as const),
	] as const;
	return fixtures.map(([name, points]) => {
		const route = toRoute([...points]);
		return {
			name,
			shape: route.shape,
			every: 2,
			// + 0: JSON keeps no −0, which Math.round leaves on a small left turn.
			stored: route.road.turns.map((t) => t + 0),
			turns: turnsOfShape(route.shape).map((t) => t + 0),
		};
	});
}

describe('a road’s turns from its own line', () => {
	it('rebuild the turns the import stored, as the server rebuilds them', async () => {
		const built = await vectors();
		if (process.env.UPDATE_GOLDEN === '1')
			writeFileSync(
				PATH,
				JSON.stringify(
					{
						about:
							'Turns rebuilt from a route’s sealed line, written by web/src/lib/road/turns.golden.test.ts with UPDATE_GOLDEN=1 and read by server/internal/road. Invented fixtures only.',
						vectors: built,
					},
					null,
					1,
				) + '\n',
			);
		const golden = JSON.parse(readFileSync(PATH, 'utf8')) as {
			vectors: typeof built;
		};
		expect(golden.vectors).toEqual(built);
		for (const v of built) {
			// Within a degree of the import's own at every step: the shape
			// keeps the line to 1e-6°, about 0.1 m.
			expect(v.turns).toHaveLength(v.stored.length);
			let drift = 0;
			for (let i = 0; i < v.turns.length; i++) {
				drift += v.turns[i] - v.stored[i];
				expect(Math.abs(drift), `${v.name} at step ${i}`).toBeLessThanOrEqual(
					1,
				);
			}
		}
	});
});
