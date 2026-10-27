import type { Cheer } from '$lib/protocol';

/** A cheer this recent is one the phone remote's Cheer back answers (#4253). */
export const CHEER_BACK_MS = 60_000;

/**
 * Who Cheer back cheers: the rider who last cheered you, by name or the whole
 * channel, inside CHEER_BACK_MS; otherwise everyone, an empty `to`. Feed it
 * each tick's cheers with `heard`; your own never count.
 */
export function createCheerBack(me: () => string | undefined) {
	let last: { from: string; at: number } | null = null;
	return {
		heard(cheers: readonly Cheer[] | undefined, now: number) {
			for (const c of cheers ?? []) {
				const mine = me();
				if (!c.fromId || c.fromId === mine) continue;
				if (c.to && c.to !== mine) continue;
				last = { from: c.fromId, at: now };
			}
		},
		to(now: number): string {
			return last && now - last.at <= CHEER_BACK_MS ? last.from : '';
		},
	};
}
