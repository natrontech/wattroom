import { CHUNK_M } from '../place/lattice';
import type { Salt } from '../place/keyed';
import { WORLD_SALT } from '../place/network.test-helper';
import { setPieces } from '../setpieces';
import type { Line } from '../terrain/lines';
import { build, origin } from '../terrain/network.test-helper';
import { createPlacer } from './placer';
import { scatter, villageSites } from './scatter';
import { standTiles } from './stand';
import { tileKey, tileOf } from './tiles';

/**
 * #3226's network, every tile its drawn ground touches settled as a ride
 * would settle it (#3699): what two routes over one place must agree on.
 */
export function standNetwork(lines: Line[], salt: Salt = WORLD_SALT) {
	const w = build(lines, salt);
	const place = {
		salt,
		origin,
		ground: w.ground,
		heightAt: w.terrain.heightAt,
		biomeAt: w.terrain.biomeAt,
	};
	const villages = villageSites(place);
	const placer = createPlacer(
		(x, z) => w.ground.roadSurfaceAt(x, z) ?? w.terrain.heightAt(x, z),
		w.ground.lines,
	);
	const set = setPieces({ ...place, placer, villages });
	const tiles = standTiles(scatter(place, placer, villages, set), set, origin);
	const ids = new Map<string, [number, number]>();
	const last = CHUNK_M - 0.01;
	for (const [ci, cj] of w.cover.chunks)
		for (const [dx, dz] of [
			[0, 0],
			[last, 0],
			[0, last],
			[last, last],
		]) {
			const t = tileOf(ci * CHUNK_M + dx, cj * CHUNK_M + dz, origin);
			ids.set(tileKey(...t), t);
		}
	const stood = [...ids.values()]
		.sort((a, b) => a[1] - b[1] || a[0] - b[0])
		.map(([ti, tj]) => tiles.tile(ti, tj));
	const standing = stood.flatMap((t) => t.standing);
	return {
		lines: w.ground.lines,
		props: stood.flatMap((t) => t.props),
		pieces: standing.map((s) => s.piece),
		signs: stood.flatMap((t) => t.signs),
		arches: stood.flatMap((t) => t.arches),
		streams: set.streams(standing),
		tiles,
	};
}
