import { isLivePhase } from '$lib/channel/tick-session';

/**
 * What you rode this session, kept for the summary and the graph: the trace
 * for the line, every sample for the medal maths. Shared between the ride
 * (which writes) and the summary (which reads) — the one seam the two had in
 * common when they lived in one component.
 *
 * Neither is capped. The trace used to keep its last 898 entries, from #98
 * when it fed a rolling strip; IntervalGraph draws it against the WORKOUT
 * clock across the whole ride, so on anything past 15 minutes the cap ate the
 * start of the line — the graph, the TV mode and the saved summary all lost
 * it (#2017). The ride's own length is the ceiling.
 *
 * One point per second, never downsampled here: IntervalGraph thins the line
 * it builds (#2878). Raw state, replaced on every push rather than mutated:
 * a deep proxy put a trap on every point each time the line was read, and a
 * new array is what tells the graph there is a new point.
 */
export function createRecording() {
	let trace = $state.raw<{ t: number; w: number }[]>([]);
	let samples = $state.raw<{ watts: number }[]>([]);
	// One sample per timeline second (#1411): the summary reads the record
	// as one entry per second — Σ watts / 1000 = kJ, sixty entries = a
	// minute — and a trainer notifying at 2 Hz used to double both. The
	// server's record admits the same way (#791).
	let lastSecond = -1;
	// The recording belongs to ONE session (#1535): it clears on the edge into
	// one, on every client. The edge is remembered here, beside what it clears
	// and for exactly as long — a summary that remounted with every page
	// crossed it again mid-ride and wiped the graph (#2654).
	let live = false;
	function reset() {
		trace = [];
		samples = [];
		lastSecond = -1;
	}
	return {
		get trace() {
			return trace;
		},
		get samples() {
			return samples;
		},
		record(elapsed: number, watts: number) {
			const second = Math.floor(elapsed);
			if (second <= lastSecond) return;
			lastSecond = second;
			trace = [...trace, { t: elapsed, w: watts }];
			samples = [...samples, { watts: Math.max(0, Math.round(watts)) }];
		},
		/** Fed every phase the session passes through; clears on the way in. */
		follow(phase: string | undefined) {
			const now = isLivePhase(phase);
			if (now && !live) reset();
			live = now;
		},
	};
}
