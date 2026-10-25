import { untrack } from 'svelte';
import { api } from '$lib/api';
import {
	callMarks,
	callSaid,
	crossedMark,
	finishedIn,
	gapLine,
	gapSince,
	ghostLabel,
	ghostMetreAt,
	newBestOn,
	secondsTo,
	splitAt,
} from '$lib/road/ghost';
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
 * A call for the strip above the Skyline and the narrator (#3246): the gap
 * at a quarter, halfway, three quarters and 500 m to go, or a new best at
 * the end. Each one is a new object, staged once.
 */
export interface GhostCall {
	kind: 'split' | 'pr';
	/** The strip's label: "Halfway", "New best". */
	name: string;
	/** The strip's words: "Your best · 12 s ahead", "14 s faster". */
	line: string;
	/** What the narrator says: "Halfway, 12 seconds ahead of your best". */
	said: string;
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
	// Your own line, a metre each pedalled second as the ghost's is (#3246):
	// the climb card's gap since a foot, the calls, and when you reached the
	// end. Plain, not state: the clock that extends it is what the reads track.
	let mine: number[] = [0];
	let lastM = 0;
	let heard = 0;
	let finish = $state<number | null>(null);
	let call = $state.raw<GhostCall | null>(null);
	function restart() {
		mine = [0];
		lastM = heard = 0;
		finish = null;
		call = null;
	}
	function extend(seconds: number, m: number) {
		if (seconds + 1 < mine.length) mine = [0];
		while (mine.length <= seconds) mine.push(m);
	}
	$effect(() => {
		const id = own;
		if (id === readFor) return;
		readFor = id;
		ghost = null;
		restart();
		if (!id || untrack(() => ride()?.road?.m ?? 0) > 0) return;
		void loadGhost(id).then((read) => {
			if (readFor === id) ghost = read;
		});
	});
	const label = $derived(ghost ? ghostLabel(new Date(ghost.startedAt)) : '');
	/** The ride and its ghost on the first lap, whatever drives the trainer. */
	function riding() {
		const free = ride();
		const road = free?.road;
		if (!free || !ghost || !road || road.lap > 0 || !free.recording)
			return null;
		return { free, road, ghost };
	}
	/** The ride and its ghost while you race it: your own watts, on the first lap. */
	function racing() {
		const on = riding();
		return on?.free.mode === 'grade' ? on : null;
	}
	$effect(() => {
		const on = riding();
		if (!on) return;
		const { seconds, mode } = on.free;
		const { m, length, name, atEnd } = on.road;
		untrack(() => {
			// A new ride on the same road: its clock starts again.
			if (seconds < heard) restart();
			heard = seconds;
			// Your line and the marks keep up in Watts too, so a stretch the
			// trainer held is neither a climb's foot nor a late call.
			extend(seconds, m);
			const { metres, best } = on.ghost;
			const mark = crossedMark(callMarks(length), lastM, m);
			lastM = m;
			if (mode !== 'grade') return;
			const split = splitAt(metres, m, seconds);
			if (mark && split !== null)
				call = {
					kind: 'split',
					name: mark.name,
					line: gapLine(split, best),
					said: callSaid(mark.name, split, best),
				};
			// Only your best is a best to beat: a last ride is not a record.
			if (!atEnd || !best || finish !== null) return;
			const you = secondsTo(mine, length);
			if (you === null) return;
			finish = you - finishedIn(metres, length);
			const beat = newBestOn(name, finish);
			if (beat)
				call = {
					kind: 'pr',
					name: 'New best',
					line: beat.faster,
					said: beat.said,
				};
		});
	});
	return {
		/** Seconds behind (+) or ahead (−) of your ghost here; null with none. */
		get split(): { seconds: number; best: boolean } | null {
			const on = racing();
			if (!on) return null;
			const seconds = splitAt(on.ghost.metres, on.road.m, on.free.seconds);
			return seconds === null ? null : { seconds, best: on.ghost.best };
		},
		/**
		 * The gap since `fromM` (#3246): the climb card's line from a climb's
		 * foot, once you are past it; null with no ghost to race.
		 */
		since(fromM: number): { seconds: number; best: boolean } | null {
			const on = racing();
			if (!on) return null;
			extend(on.free.seconds, on.road.m);
			const seconds = gapSince(
				on.ghost.metres,
				mine,
				fromM,
				on.road.m,
				on.free.seconds,
			);
			return seconds === null ? null : { seconds, best: on.ghost.best };
		},
		/** The latest call for the strip and the narrator (#3246); null before the first. */
		get call(): GhostCall | null {
			return call;
		},
		/**
		 * How much faster than your best you reached the road's end, as the
		 * closing card says it (#3246); null when not, or once the ride is no
		 * longer yours to time: the trainer held it in Watts (ADR-0074).
		 */
		get newBest(): string | null {
			const free = ride();
			if (finish === null || !free?.road || free.mode !== 'grade') return null;
			return newBestOn(free.road.name, finish)?.line ?? null;
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

export type GhostSplit = ReturnType<typeof createGhostSplit>;
