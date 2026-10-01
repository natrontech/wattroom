// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { check, tally } from './check';
import {
	corridor,
	rect,
	steep,
	syntheticLoop,
	MARKS,
} from './fixtures.test-helper';
import type { P2 } from './geom';
import {
	GATES,
	type Ground,
	type Placement,
	type Road,
	type Rule,
} from './types';

/**
 * #3219: every gate goes red on a placement that reproduces the bug the
 * audit found, and stays green on the same object placed right. A gate
 * that never fires, or fires on everything, fails one side or the other.
 */
const rules = (ps: Placement[], roads: Road[], ground: Ground) =>
	check(ps, roads, ground).map((v) => v.rule);
const kit = (
	id: string,
	kind: string,
	footprint: P2[],
	ground: Ground,
	o: Partial<Placement> = {},
): Placement => {
	const c = footprint.reduce(
		(s, p) => [s[0] + p[0] / footprint.length, s[1] + p[1] / footprint.length],
		[0, 0],
	);
	return {
		id,
		kind,
		cls: 'kit',
		footprint,
		base: ground(c[0], c[1]),
		height: 1.2,
		...o,
	};
};
const flat: Ground = () => 100;
const slope =
	(grade: number): Ground =>
	(x) =>
		100 + grade * x;

describe('the placement gates (#3219)', () => {
	it('O5: two flagpoles on one spot fail, and two a hand apart; a flagpole a metre on passes', () => {
		const a = kit('flag-1', 'flag', rect(0, 20, 0.2, 0.2), flat);
		const stacked = kit('flag-2', 'flag', rect(0.05, 20, 0.2, 0.2), flat);
		const near = kit('flag-3', 'flag', rect(0.3, 20, 0.2, 0.2), flat);
		const apart = kit('flag-4', 'flag', rect(1.2, 20, 0.2, 0.2), flat);
		expect(rules([a, stacked], [], flat)).toContain('O5');
		// 0.1 m between them, and no overlap: only the same-kind spacing sees it.
		expect(rules([a, near], [], flat)).toEqual(['O5']);
		expect(rules([a, apart], [], flat)).toEqual([]);
	});

	it('O5: a signpost half a metre inside a fountain fails; one beside it, or declared, passes', () => {
		const fountain = kit('f', 'fountain', rect(0, 20, 3, 3), flat);
		const inside = kit(
			's',
			'signpost',
			rect(1.5 - 0.5 + 0.15, 20, 0.3, 0.3),
			flat,
		);
		const beside = kit('s2', 'signpost', rect(2.5, 20, 0.3, 0.3), flat);
		expect(rules([fountain, inside], [], flat)).toContain('O5');
		expect(rules([fountain, beside], [], flat)).toEqual([]);
		expect(
			rules([fountain, { ...inside, mayOverlap: ['fountain'] }], [], flat),
		).toEqual([]);
	});

	it('O1: a church whose 29 m foundation reaches 1.3 m from the asphalt fails; set back 8 m it passes', () => {
		const { roads } = corridor();
		const hw = roads[0].halfWidth;
		const church = (edge: number): Placement => ({
			id: 'church',
			kind: 'church',
			cls: 'building',
			height: 20,
			base: 500,
			footprint: rect(400, hw + edge + 29 / 2, 12, 29),
		});
		expect(rules([church(1.3)], roads, () => 500)).toContain('O1');
		expect(rules([church(8.2)], roads, () => 500)).toEqual([]);
	});

	it('O1: on the inside of a bend a building keeps its 8 m plus the bend’s sag; outside, 8 m will do', () => {
		// A 100 m radius bend to the left, its drawn edge sagging 0.5 m on the inside.
		const points: P2[] = Array.from({ length: 61 }, (_, i) => {
			const a = (i / 60) * (Math.PI / 2);
			return [100 * Math.sin(a), -100 + 100 * Math.cos(a)] as P2;
		});
		const road: Road = { points, halfWidth: 3.2, sag: 0.5 };
		const mid = Math.PI / 4;
		const house = (r: number): Placement => ({
			id: 'house',
			kind: 'house',
			cls: 'building',
			height: 8,
			base: 100,
			footprint: rect(r * Math.sin(mid), -100 + r * Math.cos(mid), 6, 6, -mid),
		});
		const edge = 3.2 + 8.2 + 3; // 8.2 m from the edge, to the house's near side
		expect(rules([house(100 - edge)], [road], flat)).toContain('O1');
		expect(rules([house(100 + edge)], [road], flat)).toEqual([]);
	});

	it('O1: a bench on a side road’s verge fails, as the place lab’s guideposts and benches did', () => {
		const { roads, ground } = corridor();
		const side = roads[1];
		const onVerge = kit(
			'bench',
			'bench',
			rect(1000 + side.halfWidth + 0.8, -200, 1.6, 0.5),
			ground,
		);
		const inField = kit(
			'bench2',
			'bench',
			rect(1000 + 30, -200, 1.6, 0.5),
			ground,
		);
		expect(rules([onVerge], roads, ground)).toContain('O1');
		// Four metres off the main road is still inside a small kit's six.
		const four = kit(
			'bench3',
			'bench',
			rect(600, roads[0].halfWidth + 4 + 0.25, 1.6, 0.5),
			ground,
		);
		expect(rules([four], roads, ground)).toContain('O1');
		expect(rules([inField], roads, ground)).toEqual([]);
	});

	it('O1: road furniture stands 0.3–1.6 m from its edge, and an overhead span keeps 6 m of headroom', () => {
		const { roads, ground } = corridor();
		const hw = roads[0].halfWidth;
		const post = (edge: number): Placement => ({
			...kit('d', 'delineator', rect(300, hw + edge + 0.05, 0.1, 0.1), ground),
			cls: 'furniture',
		});
		expect(rules([post(0.8)], roads, ground)).toEqual([]);
		expect(rules([post(0.1)], roads, ground)).toContain('O1');
		expect(rules([post(3)], roads, ground)).toContain('O1');
		const arch = (underside: number, leg: number): Placement => ({
			id: 'arch',
			kind: 'arch',
			cls: 'overhead',
			height: 8,
			base: 500,
			underside,
			footprint: rect(500, 0, 1, 2 * (hw + leg + 1)),
			supports: [
				rect(500, hw + leg + 0.5, 1, 1),
				rect(500, -hw - leg - 0.5, 1, 1),
			],
			travel: [1, 0],
			across: [0, 1],
		});
		expect(rules([arch(506.5, 1.5)], roads, ground)).toEqual([]);
		expect(rules([arch(504, 1.5)], roads, ground)).toContain('O1');
		expect(rules([arch(506.5, 0.3)], roads, ground)).toContain('O1');
	});

	it('O2: a fence sunk a constant 0.15 m floats across a slope; one along the contour does not', () => {
		const ground = slope(0.2);
		const footprint = rect(0, 30, 3, 0.2);
		const sunk = kit('fence', 'fence', footprint, ground, {
			base: ground(0, 30) - 0.15,
		});
		// Run along the contour instead, it stands on the ground the whole way.
		const low = kit('fence', 'fence', rect(0, 30, 0.2, 3), ground);
		expect(rules([sunk], [], ground)).toContain('O2');
		expect(rules([low], [], ground)).toEqual([]);
	});

	it('O2 and O3: a barn hanging 2.75 m fails, and one buried 7.6 m fails', () => {
		const footprint = rect(0, 40, 10, 14);
		const barn = (base: number): Placement => ({
			id: 'barn',
			kind: 'barn',
			cls: 'building',
			height: 9,
			base,
			footprint,
		});
		expect(rules([barn(102.75)], [], flat)).toEqual(['O2']);
		expect(rules([barn(92.4)], [], flat)).toEqual(['O3']);
		expect(rules([barn(100)], [], flat)).toEqual([]);
		expect(rules([{ ...barn(92.4), hillside: true }], [], flat)).toEqual([]);
	});

	it('O2: a delineator set at the centreline’s height floats on a banked hairpin; one on the drawn ground does not', () => {
		const { roads, ground, hairpins } = steep();
		const [cx, cz] = hairpins[1];
		// On the inside edge of the second hairpin, beyond the edge where the bank has pulled the ground down.
		const r = STEEP_R() - roads[0].halfWidth - 0.6;
		const at: P2 = [cx - r, cz];
		const centreline = ground(cx - STEEP_R(), cz);
		const post = (base: number): Placement => ({
			...kit('d', 'delineator', rect(at[0], at[1], 0.1, 0.1), ground),
			cls: 'furniture',
			base,
		});
		expect(ground(at[0], at[1])).toBeLessThan(centreline - GATES.float);
		expect(rules([post(centreline)], roads, ground)).toContain('O2');
		expect(
			rules([post(ground(at[0], at[1]))], roads, ground).filter(
				(x) => x !== 'O1',
			),
		).toEqual([]);
	});

	it('O4: a leaning post, a sign turned from its traffic, and an arch off square fail; true ones pass', () => {
		const at = rect(0, 20, 0.3, 0.3);
		const one = (o: Partial<Placement>) =>
			rules([kit('x', 'sign', at, flat, o)], [], flat);
		expect(one({ up: [0.1, 1, 0] })).toContain('O4');
		expect(one({ up: [0, 1, 0] })).toEqual([]);
		expect(one({ facing: [1, 0], travel: [1, 0] })).toContain('O4');
		expect(one({ facing: [-1, 0.3], travel: [1, 0] })).toEqual([]);
		expect(one({ across: [0.17, 1], travel: [1, 0] })).toContain('O4');
		expect(one({ across: [0.02, 1], travel: [1, 0] })).toEqual([]);
	});

	it('finds nothing on correct placements across every fixture', () => {
		const loop = syntheticLoop();
		const { roads, ground, marks } = corridor();
		const placed = marks.map(({ kind, at }) =>
			kit(kind, kind, rect(at[0], at[1], 2, 2), ground),
		);
		expect(check(placed, roads, ground)).toEqual([]);
		expect(marks.map((m) => m.kind)).toEqual([...MARKS]);
		expect(loop.roads[0].points.length).toBeGreaterThan(100);
		expect(
			Number.isFinite(
				loop.ground(loop.roads[0].points[50][0], loop.roads[0].points[50][1]),
			),
		).toBe(true);
	});
});

describe('the rejection tally', () => {
	it('gives each kind its rejection rate, and names a kind that never made it', () => {
		const t = tally();
		const v = (rule: Rule) => [{ rule, id: 'x', kind: 'k', by: 1, why: '' }];
		for (let i = 0; i < 7; i++) t.accept('bench');
		for (let i = 0; i < 3; i++) t.reject('bench', v('O1'));
		for (let i = 0; i < 4; i++) t.reject('chapel', v('O5'));
		expect(t.rate('bench')).toBeCloseTo(0.3, 9);
		expect(t.starved()).toEqual(['chapel']);
		expect(t.counts.get('chapel')?.by).toEqual({ O5: 4 });
	});
});

describe('the budget', () => {
	it('checks a corridor’s worth of placements well inside the web job’s 20 s', () => {
		const { roads, ground } = corridor();
		const many: Placement[] = [];
		for (let i = 0; i < 3000; i++)
			many.push(
				kit(
					`t${i}`,
					'tree',
					rect((i % 200) * 10, 20 + Math.floor(i / 200) * 10, 1, 1),
					ground,
				),
			);
		const t0 = performance.now();
		expect(check(many, roads, ground)).toEqual([]);
		expect(performance.now() - t0).toBeLessThan(10_000);
	});
});

function STEEP_R() {
	return 8;
}
