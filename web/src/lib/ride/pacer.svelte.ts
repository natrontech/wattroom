import { untrack } from 'svelte';
import { hairpinsOf } from '#lib/road/climbs.ts';
import { ghostMetreAt } from '#lib/road/ghost.ts';
import {
	PACER_GAP_M,
	PACER_PAR,
	pacerLine,
	type PacerCategory,
} from '#lib/road/pacer.ts';
import { play } from '#lib/sound/cues.ts';
import type { FreeRide } from './free-ride.svelte';
import type { GhostRider } from './ghost-split.svelte';

/** The pacer near you (#3281): metres it is ahead (+) or behind (−), and its Category. */
export interface PacerGap {
	metres: number;
	category: PacerCategory;
}

/**
 * The pacer on a solo route ride (#3281, docs/spec/races.md "The pacer"):
 * off until you pick a Category, then a par rider set off where you did, on
 * your pedalled seconds as your ghost is. Drawn only while your own watts
 * move your dot — Road mode, the first lap — and only on your screen: the hub
 * never hears of it, so it is never in a session, never shelters anyone and
 * pays nothing. Called in an effect root: the $effect needs it.
 */
export function createPacer(ride: () => FreeRide | null | undefined) {
	let category = $state<PacerCategory | null>(null);
	// Its road, start and Category alone: the road itself is a new object every second.
	const key = $derived.by(() => {
		const road = ride()?.road;
		return category && road && road.lap === 0 && !road.reverse
			? `${road.id}|${road.from}|${category}`
			: null;
	});
	const line = $derived.by(() => {
		if (!key || !category) return null;
		const wkg = PACER_PAR[category];
		return untrack(() => {
			const road = ride()?.road;
			return road
				? {
						metres: pacerLine(road.profile, wkg, road.from),
						hairpins: hairpinsOf(road.profile),
					}
				: null;
		});
	});
	const now = $derived.by(() => {
		const free = ride();
		const road = free?.road;
		if (!line || !category || !free?.recording || free.mode !== 'grade')
			return null;
		if (!road || road.lap > 0) return null;
		const { metres } = line;
		const s = free.seconds;
		const m = ghostMetreAt(metres, s);
		if (m === null) return null;
		// Its clock is your pedalled seconds: while you rest, it waits too.
		const i = Math.max(0, Math.min(Math.floor(s), metres.length - 2));
		const mps =
			metres.length > 1 && road.virtualMps > 0 ? metres[i + 1] - metres[i] : 0;
		return { m, mps, gap: m - road.m, category };
	});

	// Its horn at a hairpin it rounds within PACER_GAP_M of you.
	let lastM: number | null = null;
	$effect(() => {
		const at = now;
		untrack(() => {
			const was = lastM;
			lastM = at?.m ?? null;
			if (!at || !line || was === null || Math.abs(at.gap) > PACER_GAP_M)
				return;
			if (line.hairpins.some((h) => was < h && h <= at.m)) play('horn');
		});
	});

	return {
		/** The Category picked; null with no pacer. */
		get category() {
			return category;
		},
		/** Ride with the pacer of this Category, or none; a pick sounds its horn. */
		pick(next: PacerCategory | null) {
			category = next;
			if (next) play('horn');
		},
		/** Where it rides now, as your ghost does; null with none on the road. */
		get rider(): GhostRider | null {
			return now
				? {
						m: now.m,
						mps: Math.max(0, now.mps),
						label: `Pacer ${now.category}`,
					}
				: null;
		},
		/** The gap, within PACER_GAP_M; null further, or with none. */
		get gap(): PacerGap | null {
			return now && Math.abs(now.gap) <= PACER_GAP_M
				? { metres: now.gap, category: now.category }
				: null;
		},
	};
}

export type Pacer = ReturnType<typeof createPacer>;
