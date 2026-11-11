import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packRoad } from '#lib/road/road.ts';
import { HOME_ROADS, homeRoute } from './home-roads';

/**
 * WattRoom's roads as the server rides them in a session: a frozen copy of
 * the road each builds here, in server/internal/routes/library. A change to
 * the generator or the import moves these bytes; rewrite them with
 * `UPDATE_GOLDEN=1 pnpm exec vitest run src/lib/ride/home-roads.golden.test.ts`
 * and commit both, or a crew rides another road than its riders draw.
 */
const fileOf = (id: string) =>
	new URL(
		`../../../../server/internal/routes/library/${id}.road`,
		import.meta.url,
	);

describe('the server’s copy of WattRoom’s roads', () => {
	it.each(HOME_ROADS.map((r) => [r.name, r] as const))(
		'%s is the road this builds',
		async (_, home) => {
			const built = packRoad((await homeRoute(home)).road);
			if (process.env.UPDATE_GOLDEN === '1')
				writeFileSync(fileOf(home.routeId), built);
			expect(new Uint8Array(readFileSync(fileOf(home.routeId)))).toEqual(built);
		},
	);
});

describe('WattRoom’s roads in a session’s pickers', () => {
	it('list under the ids the server rides them by, and read back by them', async () => {
		const { wattroomRoads, homeRoad } = await import('./home-roads');
		const rows = await wattroomRoads();
		expect(rows.map((r) => r.id)).toEqual(HOME_ROADS.map((r) => r.routeId));
		for (const row of rows) expect(homeRoad(row.id)?.routeId).toBe(row.id);
	});
});
