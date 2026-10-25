import { untrack } from 'svelte';
import { api } from '$lib/api';
import { ghostLabel, ghostMetreAt, splitAt } from '$lib/road/ghost';
import type { FreeRide } from './free-ride.svelte';

/** Your ghost on a road (#3033): one of your own rides of it, a metre a second. */
export interface Ghost {
	/** Your 90-day best of the whole road; else your last ride of it. */
	best: boolean;
	/** When you rode it: what it is called, "Tuesday-you, 12 Aug" (#3615). */
	startedAt: string;
	metres: number[];
}

/** Where your ghost rides now (#3245): its metre and speed, and its name for the Skyline. */
export interface GhostRider {
	m: number;
	mps: number;
	label: string;
}

/**
 * Your ghost on this road, or null: never ridden from its start, or not
 * read — neither is anything wrong, so neither says anything (#3615).
 */
export async function loadGhost(routeId: string): Promise<Ghost | null> {
	const res = await api<Ghost>(
		`/api/routes/${encodeURIComponent(routeId)}/ghost`,
	);
	return res.ok
		? {
				best: res.data.best,
				startedAt: res.data.startedAt,
				metres: res.data.metres,
			}
		: null;
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
	const label = $derived(ghost ? ghostLabel(new Date(ghost.startedAt)) : '');
	/** The ride and its ghost while you race it: your own watts, on the first lap. */
	function racing() {
		const free = ride();
		const road = free?.road;
		if (!free || !ghost || !road || road.lap > 0 || !free.recording)
			return null;
		return free.mode === 'grade' ? { free, road, ghost } : null;
	}
	return {
		/** Seconds behind (+) or ahead (−) of your ghost here; null with none. */
		get split(): { seconds: number; best: boolean } | null {
			const on = racing();
			if (!on) return null;
			const seconds = splitAt(on.ghost.metres, on.road.m, on.free.seconds);
			return seconds === null ? null : { seconds, best: on.ghost.best };
		},
		/** Where your ghost rides now; null with none, or once it has finished (#3245). */
		get rider(): GhostRider | null {
			const on = racing();
			if (!on) return null;
			const { metres } = on.ghost;
			const s = on.free.seconds;
			const m = ghostMetreAt(metres, s);
			if (m === null) return null;
			// Its clock is your pedalled seconds: while you rest, it waits too.
			const i = Math.max(0, Math.min(Math.floor(s), metres.length - 2));
			const mps =
				metres.length > 1 && on.road.virtualMps > 0
					? metres[i + 1] - metres[i]
					: 0;
			return { m, mps: Math.max(0, mps), label };
		},
	};
}
