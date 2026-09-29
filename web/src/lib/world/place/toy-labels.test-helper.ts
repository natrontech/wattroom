import { keyed, unit } from './keyed';
import type { BuiltWorld, Thing } from './shared';
import type { Network, Route } from './network.test-helper';
import { NAMES, type Ctx, type Toy } from './toy-context.test-helper';

/** The toy's set pieces, hairpins, arch, names and horizon: everything a sign or a label says. */
export function labels(
	c: Ctx,
	net: Network,
	route: Route,
	o: Toy,
): Pick<BuiltWorld, 'signs' | 'arch' | 'names' | 'horizon'> {
	const {
		mut,
		salt,
		xy,
		routeXY,
		along,
		length,
		keyAt,
		place,
		seen,
		routeIndexOf,
	} = c;
	const roadXY = net.roads.map((r) => r.points.map(xy));
	// Set pieces: every 250 m of a road's own metre — or, keyed by the route, every minute of riding from its start.
	const signs: Thing[] = [];
	for (const [ri, r] of net.roads.entries()) {
		const pts = roadXY[ri];
		const m: number[] = [0];
		for (let i = 1; i < pts.length; i++)
			m.push(
				m[i - 1] +
					Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
			);
		const L = m.at(-1)!;
		const pointAt = (d: number) =>
			r.points[
				Math.max(
					0,
					m.findIndex((v) => v >= d),
				)
			];
		if (mut !== 'riding-time')
			for (let s = 0; s * 250 < L; s++) {
				if (unit(keyed(salt, 'setpiece', ri, s)) >= 0.8) continue;
				const d = s * 250 + unit(keyed(salt, 'setpiece', ri, s, 1)) * 50;
				const p = pointAt(d);
				if (seen(p))
					signs.push(
						place('marker', p, `${((L - d) / 1000).toFixed(1)} km to the top`),
					);
			}
		// Hairpins, numbered from the top of the road — or from wherever the route came in.
		const order = [...r.hairpins].sort((a, b) =>
			mut === 'hairpins-from-start'
				? routeIndexOf(r.points[a]) - routeIndexOf(r.points[b])
				: r.heights[b] - r.heights[a],
		);
		for (const [n, i] of order.entries())
			if (seen(r.points[i]))
				signs.push(place('hairpin', r.points[i], `Kehre ${n + 1}`));
	}
	if (mut === 'riding-time')
		for (let s = 0; s * 300 < length; s++) {
			const p =
				route.points[
					Math.max(
						0,
						along.findIndex((v) => v >= s * 300),
					)
				];
			if (seen(p)) signs.push(place('marker', p, `${s} min`));
		}
	const arch = place(
		'arch',
		mut === 'riding-time' ? route.points[0] : net.roads[0].points[0],
	);

	// Names: the map's, or one seeded by the place's 5 km tile — or drawn in riding order from one stream.
	let stream = salt[0];
	const draw = () =>
		(stream = (Math.imul(stream, 1664525) + 1013904223) >>> 0) / 2 ** 32;
	const riding = net.features
		.map((f, i) => ({
			f,
			i,
			at: routeIndexOf(f.at),
			d: Math.hypot(
				...xy(f.at).map((v, q) => v - routeXY[routeIndexOf(f.at)][q]),
			),
		}))
		.filter((x) => x.d < 300)
		.sort((a, b) => a.at - b.at);
	const streamed = new Map(
		riding
			.filter((x) => !x.f.name)
			.map((x) => [x.i, NAMES[Math.floor(draw() * NAMES.length)]]),
	);
	const names = net.features
		.map((f, i) => {
			if (Math.hypot(...xy(f.at)) > 2000) return null;
			if (f.name) return f.name;
			if (mut === 'name-stream') return streamed.get(i) ?? null;
			const k = keyAt(f.at);
			return NAMES[
				keyed(salt, 'name', Math.floor(k.e / 5000), Math.floor(k.n / 5000)) %
					NAMES.length
			];
		})
		.filter((n): n is string => n !== null);

	const cam = keyAt(o.camera);
	const horizon = `${cam.frame}:${Math.round(cam.e / 2000)}:${Math.round(cam.n / 2000)}`;

	return { signs, arch, names, horizon };
}
