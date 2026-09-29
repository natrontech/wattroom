import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { climbsOf, type Climb } from './climbs';
import { bridgeAndTunnel, hairpinClimb, switchback } from './fixtures';
import { toRoute } from './route';

/**
 * The climb rule's golden vectors (#3238): roads and the climbs on them,
 * read by this suite and by the Go twin's (server/internal/road). The roads
 * are #3023's synthetic fixtures as the pipeline stores them, and roads built
 * to sit exactly on the rule's limits. Written here, because the fixtures
 * are this side's: `UPDATE_GOLDEN=1 pnpm exec vitest run
 * src/lib/road/climbs.golden.test.ts`, then commit the file — both suites
 * must still pass on it.
 */
const PATH = new URL(
	'../../../../server/internal/protocol/testdata/climbs-golden.json',
	import.meta.url,
);

type Vector = {
	name: string;
	length: number;
	heights: number[];
	climbs: Climb[];
};

const STEP = 20;

/**
 * A road drawn in whole centimetres, a sample every 20 m, from legs of
 * [samples, centimetres per sample]: exact, so a dip sits on the limit rather
 * than a rounding error either side of it.
 */
function drawn(...legs: [number, number][]) {
	const cm = [50_000];
	for (const [samples, rise] of legs)
		for (let k = 0; k < samples; k++) cm.push(cm[cm.length - 1] + rise);
	return { length: STEP * (cm.length - 1), heights: cm.map((c) => c / 100) };
}

function inputs(): Omit<Vector, 'climbs'>[] {
	const stored = (
		name: string,
		points: () => ReturnType<typeof switchback>,
	) => {
		const { road } = toRoute(points());
		return { name, length: road.length, heights: road.heights };
	};
	return [
		stored(
			'the 2 % road under a bridge dip and a tunnel hump',
			bridgeAndTunnel,
		),
		stored('a 9 m switchback climbing 6 %', switchback),
		stored('a climb of 21 hairpins at 8 %', hairpinClimb),
		{
			// Up 60 m, down exactly the 20 m a dip may lose, and back over the
			// top 200 m after it — well inside the 300 m — so the loss alone
			// ends the climb: two climbs.
			name: 'a dip that loses exactly the rule’s 20 m',
			...drawn([50, 120], [5, -400], [5, 400], [45, 200]),
		},
		{
			// The same dip a centimetre shallower — 19.99 m — and back over
			// the top 200 m after it: one climb.
			name: 'a dip a centimetre inside the rule',
			...drawn([50, 120], [4, -400], [1, -399], [5, 400], [45, 200]),
		},
		{
			// Down 5 m and back level with the top exactly 300 m after it: the
			// dip has lasted the rule's 300 m, and the climb ends there.
			name: 'a dip that lasts exactly the rule’s 300 m',
			...drawn([50, 120], [5, -100], [10, 50], [40, 150]),
		},
	];
}

function vectors(): Vector[] {
	return inputs().map((v) => ({
		...v,
		climbs: climbsOf({ length: v.length, heights: v.heights, turns: [] }),
	}));
}

if (process.env.UPDATE_GOLDEN === '1')
	writeFileSync(
		PATH,
		JSON.stringify(
			{
				about:
					'The climb rule’s golden vectors (#3238), written by web/src/lib/road/climbs.golden.test.ts with UPDATE_GOLDEN=1 and read by server/internal/road; both land on the same centimetre.',
				vectors: vectors(),
			},
			null,
			2,
		) + '\n',
	);

const golden = JSON.parse(readFileSync(PATH, 'utf8')) as { vectors: Vector[] };

describe('the climb rule’s golden vectors', () => {
	it('holds every road this side defines', () => {
		expect(golden.vectors.map((v) => v.name)).toEqual(
			inputs().map((v) => v.name),
		);
	});

	for (const v of golden.vectors)
		it(v.name, () => {
			expect(
				climbsOf({ length: v.length, heights: v.heights, turns: [] }),
			).toEqual(v.climbs);
		});

	it('puts each limit where the rule says', () => {
		const tops = (name: string) =>
			golden.vectors.find((v) => v.name === name)!.climbs.map((c) => c.topM);
		expect(tops('a dip that loses exactly the rule’s 20 m')).toHaveLength(2);
		expect(tops('a dip a centimetre inside the rule')).toHaveLength(1);
		expect(tops('a dip that lasts exactly the rule’s 300 m')).toHaveLength(2);
	});
});
