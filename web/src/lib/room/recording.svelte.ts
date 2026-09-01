/**
 * What you rode this session, kept for the summary and the graph: a bounded
 * trace for the horizon and every sample for the medal maths. Shared between
 * the ride (which writes) and the summary (which reads) — the one seam the
 * two had in common when they lived in one component.
 */
export function createRecording() {
	let trace = $state<{ t: number; w: number }[]>([]);
	let samples = $state<{ watts: number }[]>([]);
	return {
		get trace() {
			return trace;
		},
		get samples() {
			return samples;
		},
		record(elapsed: number, watts: number) {
			trace = [...trace.slice(-898), { t: elapsed, w: watts }];
			samples.push({ watts: Math.max(0, Math.round(watts)) });
		},
		reset() {
			trace = [];
			samples = [];
		},
	};
}
