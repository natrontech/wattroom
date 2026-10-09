import { it } from 'vitest';
import { toRoute } from '$lib/road/route';
import { generate } from './world';
import { BUILD_MS, longLoopPoints } from './world.test-helper';

it('probe', () => {
	const route = toRoute(longLoopPoints());
	const world = generate(route);
	const tiles = world
		.tilesWithin(route.x[0], route.z[0], 1500)
		.map(([ti, tj]) => world.tile(ti, tj));
	const out: string[] = [];
	for (const p of [7, 6, 5, 4, 3, 2]) {
		const s = JSON.stringify(
			tiles.map((t) => [t.props, t.pieces, t.signs, t.arches, t.placements]),
			(_, v) => (typeof v === 'number' ? +v.toPrecision(p) : v),
		);
		let h = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
		out.push(`p${p}=${(h >>> 0).toString(16)}`);
	}
	const counts = tiles.map((t) => [t.props.length, t.pieces.length, t.signs.length, t.arches.length, t.placements.length].join('/'));
	throw new Error('PROBE ' + [out.join(' '), 'tiles', tiles.length, 'counts', counts.join(',')].join(' '));
}, BUILD_MS);
