import { alone } from '../placement/check';
import type { P2 } from '../placement/geom';
import { GATES, type Class, type Placement } from '../placement/types';
import type { Line } from '../terrain/lines';
import { kitSpec, type KitKind } from './kit';
import { roadsNear, type Turn } from './roads';

/**
 * Where everything the generator stands meets #3219's gates (#3076, #3077):
 * a model stands on its own footprint, read off it (kit.ts), with its base
 * as high as its bury allows and never floating past its plinth, if every
 * gate that asks only of it passes — the roads, the ground, itself. What
 * stands beside what (O5) a tile settles by rank, never by order (tiles.ts,
 * #3699), so a place stands the same things whichever way it was reached.
 */
export function createPlacer(
	ground: (x: number, z: number) => number,
	lines: readonly Line[],
) {
	const near = roadsNear(lines);

	/** `kind` as it would stand on (x, z), turned by `turn` — or null where a gate of its own refuses it. */
	function candidate(
		kind: KitKind,
		cls: Class,
		x: number,
		z: number,
		turn: Turn,
		scale = 1,
	): Placement | null {
		const spec = kitSpec(kind);
		const [c, s] = turn;
		const footprint: P2[] = [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		].map(([a, b]) => {
			const lx = (spec.cx + a * spec.hw) * scale;
			const lz = (spec.cz + b * spec.hd) * scale;
			return [x + lx * c + lz * s, z - lx * s + lz * c];
		});
		let lo = Infinity;
		let hi = -Infinity;
		for (const [px, pz] of [...footprint, [x, z] as P2]) {
			const h = ground(px, pz);
			lo = Math.min(lo, h);
			hi = Math.max(hi, h);
		}
		const height = spec.height * scale;
		const sunk = kind === 'rock';
		const bury =
			cls === 'building'
				? 0
				: Math.min(GATES.bury.kitShare * height, GATES.bury.kitMax);
		// An erratic sits a third of its plinth deep, wherever it lies.
		const base = sunk
			? lo - spec.plinth * scale * 0.35
			: Math.max(lo, hi - bury);
		const p: Placement = {
			// Named by where it stands, so the same thing has the same name whichever tile asked first.
			id: `${kind}@${Math.round(x * 100)}:${Math.round(z * 100)}`,
			kind,
			cls,
			footprint,
			base,
			height,
			plinth: spec.plinth * scale,
			sunk,
		};
		return alone(p, near(x, z), ground).length > 0 ? null : p;
	}

	return { candidate };
}

export type Placer = ReturnType<typeof createPlacer>;
