import { admit, crowd } from '../placement/check';
import type { P2 } from '../placement/geom';
import { GATES, type Class, type Placement } from '../placement/types';
import type { Line } from '../terrain/lines';
import { kitSpec, type KitKind } from './kit';
import { roadsNear, type Turn } from './roads';

/**
 * Where everything the generator stands meets #3219's gates (#3076, #3077):
 * one crowd for set pieces and props alike, in the order they are asked, so
 * a bench never shares its spot with a spruce. A model stands on its own
 * footprint, read off it (kit.ts), with its base as high as its bury allows
 * and never floating past its plinth; it stands only if every gate passes.
 */
export function createPlacer(
	ground: (x: number, z: number) => number,
	lines: readonly Line[],
) {
	const near = roadsNear(lines);
	const crowded = crowd();
	const placements: Placement[] = [];

	/** The base `kind` stands at on (x, z), turned by `turn` — or null where the gates refuse it. */
	function stand(
		kind: KitKind,
		cls: Class,
		x: number,
		z: number,
		turn: Turn,
		scale = 1,
	): number | null {
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
			id: `${kind}-${placements.length}`,
			kind,
			cls,
			footprint,
			base,
			height,
			plinth: spec.plinth * scale,
			sunk,
		};
		if (admit(p, near(x, z), ground, crowded).length > 0) return null;
		crowded.add(p);
		placements.push(p);
		return base;
	}

	return { stand, placements };
}

export type Placer = ReturnType<typeof createPlacer>;
