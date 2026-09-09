/**
 * What you rode this session, kept for the summary and the graph: a bounded
 * trace for the horizon and every sample for the medal maths. Shared between
 * the ride (which writes) and the summary (which reads) — the one seam the
 * two had in common when they lived in one component.
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
			trace = [...trace.slice(-898), { t: elapsed, w: watts }];
			samples.push({ watts: Math.max(0, Math.round(watts)) });
		},
		reset() {
			trace = [];
			samples = [];
			lastSecond = -1;
		},
	};
}
