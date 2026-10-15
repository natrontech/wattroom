import type { LiveRider } from '$lib/channel/types';

/** #3215: the list stays at you and the 3 nearest while no offset moved more than this, in metres… */
export const SETTLED_M = 5;
/** …over this long, in ms. */
export const SETTLED_MS = 10_000;
export const NEAREST = 3;

/** Offsets by rider over the last SETTLED_MS: what says the bunch is steady. */
export function offsetWindow() {
	let samples: { at: number; offsets: Record<string, number> }[] = [];
	return {
		/** Push a tick's offsets; true while none moved more than SETTLED_M in the window. */
		settled(at: number, offsets: Record<string, number>): boolean {
			samples = samples.filter((s) => at - s.at <= SETTLED_MS);
			samples.push({ at, offsets });
			const range = new Map<string, [number, number]>();
			for (const s of samples)
				for (const [id, m] of Object.entries(s.offsets)) {
					const r = range.get(id);
					range.set(id, r ? [Math.min(r[0], m), Math.max(r[1], m)] : [m, m]);
				}
			return [...range.values()].every(([lo, hi]) => hi - lo <= SETTLED_M);
		},
	};
}

/** You and the NEAREST riders by distance when settled, everyone otherwise; the list's order stays. */
export function pelotonRows(
	riders: LiveRider[],
	offsets: Record<string, number>,
	settled: boolean,
): LiveRider[] {
	if (!settled) return riders;
	const mine = offsets[riders.find((r) => r.you)?.id ?? ''] ?? 0;
	const gap = (r: LiveRider) =>
		r.id in offsets ? Math.abs(offsets[r.id] - mine) : Infinity;
	const near = new Set(
		riders
			.filter((r) => !r.you)
			.sort((a, b) => gap(a) - gap(b))
			.slice(0, NEAREST)
			.map((r) => r.id),
	);
	return riders.filter((r) => r.you || near.has(r.id));
}
