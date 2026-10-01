import { keyed, unit } from './keyed';
import { cellOf, COARSE_M, FINE_M } from './lattice';
import { frameAt } from './project';
import type { BuiltWorld, Thing } from './shared';
import { DEM_EDGE_LAT, type Network, type Route } from './network.test-helper';
import { context, nameOf, TREES, type Toy } from './toy-context.test-helper';
import { labels } from './toy-labels.test-helper';

export type { Mutant } from './toy-context.test-helper';

/** A toy world keyed by place (toy-context.test-helper.ts says what, and why). */
export function buildToy(net: Network, route: Route, o: Toy): BuiltWorld {
	const c = context(net, route, o);
	const {
		mut,
		R,
		salt,
		xy,
		ll,
		routeXY,
		along,
		length,
		keyAt,
		floorCm,
		inRegion,
		onRoad,
	} = c;
	const cells = new Map<
		string,
		{
			frame: string;
			i: number;
			j: number;
			oe: number;
			on: number;
			spots: Set<string>;
		}
	>();
	const things: Thing[] = [];
	for (let y = -R; y <= R; y += 5)
		for (let x = -R; x <= R; x += 5) {
			if (x * x + y * y > R * R) continue;
			const p = ll(x, y);
			if (inRegion(x, y)) continue; // the region's own cells, below
			if (onRoad(x, y, 8) !== null) continue;
			const k = keyAt(p);
			const c = cellOf(k.e - k.oe, k.n - k.on, FINE_M);
			const id = `${k.frame}:${c.i}:${c.j}`;
			const rec = cells.get(id) ?? {
				frame: k.frame,
				i: c.i,
				j: c.j,
				oe: k.oe,
				on: k.on,
				spots: new Set<string>(),
			};
			rec.spots.add(nameOf(frameAt(p[0], p[1])));
			cells.set(id, rec);
		}
	// Each private end in its own cells: metres along the route from that end, metres beside it.
	const pointAlong = (a: number, side: number): [number, number] => {
		const i = Math.min(
			Math.max(
				along.findIndex((v) => v >= a),
				1,
			),
			routeXY.length - 1,
		);
		const [ax, ay] = routeXY[i - 1];
		const [bx, by] = routeXY[i];
		const L = Math.hypot(bx - ax, by - ay) || 1;
		const t = (a - along[i - 1]) / L;
		return [
			ax + t * (bx - ax) - (side * (by - ay)) / L,
			ay + t * (by - ay) + (side * (bx - ax)) / L,
		];
	};
	if (o.owner && mut !== 'region-world-secret')
		for (const [end, origin, sign] of [
			['start', 0, 1],
			['end', length, -1],
		] as const)
			for (let i = 0; i < 40; i++)
				for (let j = -10; j < 10; j++) {
					const [x, y] = pointAlong(
						origin + sign * (i + 0.5) * FINE_M,
						sign * (j + 0.5) * FINE_M,
					);
					if (x * x + y * y > R * R) continue;
					const k = keyAt(ll(x, y));
					const w =
						mut === 'region-world-cells' ? cellOf(k.e, k.n, FINE_M) : { i, j };
					const key = keyed(o.owner, 'tree', w.i, w.j);
					if (unit(key) >= 0.3) continue;
					things.push({
						kind: TREES[key % 3],
						frame: `region:${end}`,
						e:
							i * FINE_M +
							floorCm(unit(keyed(o.owner, 'tree', w.i, w.j, 1)) * FINE_M),
						n:
							j * FINE_M +
							floorCm(unit(keyed(o.owner, 'tree', w.i, w.j, 2)) * FINE_M),
					});
				}
	for (const c of cells.values()) {
		const key = keyed(salt, 'tree', c.i, c.j);
		if (unit(key) >= 0.3) continue;
		things.push({
			kind: TREES[keyed(salt, 'prop', c.i, c.j) % 3],
			frame: c.frame,
			e:
				c.oe +
				c.i * FINE_M +
				floorCm(unit(keyed(salt, 'tree', c.i, c.j, 1)) * FINE_M),
			n:
				c.on +
				c.j * FINE_M +
				floorCm(unit(keyed(salt, 'tree', c.i, c.j, 2)) * FINE_M),
			spots: [...c.spots],
		});
	}
	const ground = (lat: number, lon: number) => {
		const [x, y] = xy([lat, lon]);
		const road = onRoad(x, y, 12);
		if (road !== null) return road;
		if (lat <= DEM_EDGE_LAT)
			return 1000 + 150 * Math.sin(lat * 9000) * Math.cos(lon * 7000);
		// Past the height model's edge: keyed noise over coarse cells, bilinear.
		const k = keyAt([lat, lon]);
		const u = (k.e - k.oe) / COARSE_M;
		const v = (k.n - k.on) / COARSE_M;
		const i = Math.floor(u);
		const j = Math.floor(v);
		const h = (a: number, b: number) =>
			1000 + unit(keyed(salt, 'ground', a, b)) * 100;
		const fu = u - i;
		const fv = v - j;
		return (
			(h(i, j) * (1 - fu) + h(i + 1, j) * fu) * (1 - fv) +
			(h(i, j + 1) * (1 - fu) + h(i + 1, j + 1) * fu) * fv
		);
	};

	return { ground, things, ...labels(c, net, route, o) };
}
