import { untrack } from 'svelte';
import { api } from '$lib/api';
import { splitAt } from '$lib/road/ghost';
import type { FreeRide } from './free-ride.svelte';

/** Your ghost on a road (#3033): one of your own rides of it, a metre a second. */
export interface Ghost {
	/** Your 90-day best of the whole road; else your last ride of it. */
	best: boolean;
	metres: number[];
}

/**
 * Your ghost on this road, or null: never ridden from its start, or not
 * read — neither is anything wrong, so neither says anything (#3615).
 */
export async function loadGhost(routeId: string): Promise<Ghost | null> {
	const res = await api<Ghost>(
		`/api/routes/${encodeURIComponent(routeId)}/ghost`,
	);
	return res.ok ? { best: res.data.best, metres: res.data.metres } : null;
}

/**
 * The live split against your ghost (#3615, ADR-0068): read once, when a
 * ride takes one of your own roads from its start, and raced while your own
 * watts move the dot — grade, the first lap, and short of the ghost's end.
 * Called during component init: the $effect needs it.
 */
export function createGhostSplit(ride: () => FreeRide | null | undefined) {
	let ghost = $state.raw<Ghost | null>(null);
	// Its id alone: the road itself is a new object every second.
	const own = $derived.by(() => {
		const road = ride()?.road;
		return road && !road.borrowed ? road.id : null;
	});
	// Guarded by the road it last read for: an effect that writes state runs
	// again on its own write (Svelte 5.57), and would drop the ghost it read.
	let readFor: string | null = null;
	$effect(() => {
		const id = own;
		if (id === readFor) return;
		readFor = id;
		ghost = null;
		if (!id || untrack(() => ride()?.road?.m ?? 0) > 0) return;
		void loadGhost(id).then((read) => {
			if (readFor === id) ghost = read;
		});
	});
	return {
		/** Seconds behind (+) or ahead (−) of your ghost here; null with none. */
		get split(): { seconds: number; best: boolean } | null {
			const free = ride();
			const road = free?.road;
			if (!free || !ghost || !road || road.lap > 0 || !free.recording)
				return null;
			if (free.mode !== 'grade') return null;
			const seconds = splitAt(ghost.metres, road.m, free.seconds);
			return seconds === null ? null : { seconds, best: ghost.best };
		},
	};
}
