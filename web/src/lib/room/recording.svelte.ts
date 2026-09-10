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
 * ponytail: one point per second, never downsampled — a 3 h ride is 10 800 of
 * them in one polyline. If a long ride ever stutters, thin it in IntervalGraph
 * where the line is built, not here where the data is kept.
 */
export function createRecording() {
	let trace = $state<{ t: number; w: number }[]>([]);
	let samples = $state<{ watts: number }[]>([]);
	// One sample per timeline second (#1411): the summary reads the record
	// as one entry per second — Σ watts / 1000 = kJ, sixty entries = a
	// minute — and a trainer notifying at 2 Hz used to double both. The
	// server's record admits the same way (#791).
	let lastSecond = -1;
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
			trace.push({ t: elapsed, w: watts });
			samples.push({ watts: Math.max(0, Math.round(watts)) });
		},
		reset() {
			trace = [];
			samples = [];
			lastSecond = -1;
		},
	};
}
