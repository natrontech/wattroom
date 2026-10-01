import type { P2 } from './geom';
import { o1, o2, o3, o4, o5 } from './rules';
import type { Ground, Placement, Road, Rule, Violation } from './types';

/**
 * Running the gates (#3219). `check` measures a finished set, O5 through a
 * spatial hash so a corridor's thousands of objects stay linear; `admit`
 * measures one candidate against what is already placed, which is how a
 * generator rejects and redraws. The tally counts both ways per kind, so a
 * build can assert its rejection rate and that no kind silently starves.
 */

const CELL = 20;
const cellsOf = (poly: readonly P2[]): string[] => {
	const xs = poly.map((p) => p[0]);
	const zs = poly.map((p) => p[1]);
	const out: string[] = [];
	for (
		let i = Math.floor(Math.min(...xs) / CELL);
		i <= Math.floor(Math.max(...xs) / CELL);
		i++
	)
		for (
			let j = Math.floor(Math.min(...zs) / CELL);
			j <= Math.floor(Math.max(...zs) / CELL);
			j++
		)
			out.push(`${i}:${j}`);
	return out;
};

/** Everything that stands where others might: a hash of footprints by 20 m cell. */
export function crowd() {
	const cells = new Map<string, Placement[]>();
	return {
		near(p: Placement): Placement[] {
			const seen = new Set<Placement>();
			for (const c of cellsOf(p.footprint))
				for (const q of cells.get(c) ?? []) seen.add(q);
			return [...seen];
		},
		add(p: Placement) {
			for (const c of cellsOf(p.footprint))
				cells.set(c, [...(cells.get(c) ?? []), p]);
		},
	};
}

/** Every gate one candidate fails, against the roads, the ground and what stands already. */
export function admit(
	p: Placement,
	roads: readonly Road[],
	ground: Ground,
	placed: ReturnType<typeof crowd>,
): Violation[] {
	return [
		...o1(p, roads, ground),
		...o2(p, ground),
		...o3(p, ground),
		...o4(p),
		...placed.near(p).flatMap((q) => o5(p, q)),
	];
}

/** Every gate a finished set fails. */
export function check(
	placements: readonly Placement[],
	roads: readonly Road[],
	ground: Ground,
): Violation[] {
	const placed = crowd();
	const out: Violation[] = [];
	for (const p of placements) {
		out.push(...admit(p, roads, ground, placed));
		placed.add(p);
	}
	return out;
}

/** Accepted and rejected, per kind: the rejection rate, and the kinds that never made it. */
export function tally() {
	const counts = new Map<
		string,
		{ ok: number; no: number; by: Partial<Record<Rule, number>> }
	>();
	const of = (kind: string) => {
		const c = counts.get(kind) ?? { ok: 0, no: 0, by: {} };
		counts.set(kind, c);
		return c;
	};
	return {
		accept(kind: string) {
			of(kind).ok++;
		},
		reject(kind: string, violations: readonly Violation[]) {
			const c = of(kind);
			c.no++;
			for (const { rule } of violations) c.by[rule] = (c.by[rule] ?? 0) + 1;
		},
		/** The share of this kind's candidates that were turned away. */
		rate(kind: string): number {
			const c = of(kind);
			return c.ok + c.no === 0 ? 0 : c.no / (c.ok + c.no);
		},
		/** Kinds that were tried and never once placed. */
		starved(): string[] {
			return [...counts]
				.filter(([, c]) => c.ok === 0 && c.no > 0)
				.map(([k]) => k);
		},
		counts,
	};
}
