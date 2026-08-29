export interface TracePoint {
	/** workout-clock seconds — NOT monotonic: skip and extend shift it. */
	t: number;
	w: number;
}

/**
 * Split a power trace into continuously-ridden runs.
 *
 * The trace is keyed on workout-clock time so it lines up with the interval graph,
 * but that clock jumps: skip moves it forward over ground the rider never covered,
 * extend moves it backward over ground they are riding twice. Drawing one polyline
 * across either is a lie — forward jumps invent a straight line through work that
 * did not happen, and backward jumps draw the trace in reverse.
 *
 * Breaking into runs renders gaps as gaps and re-rides as overlapping lines, which
 * is what actually happened.
 */
export function splitTrace(
	trace: TracePoint[],
	maxGapSeconds = 3,
): TracePoint[][] {
	const runs: TracePoint[][] = [];
	let run: TracePoint[] = [];

	for (const point of trace) {
		const previous = run.at(-1);
		const continuous =
			previous === undefined ||
			(point.t > previous.t && point.t - previous.t <= maxGapSeconds);
		if (!continuous) {
			if (run.length > 1) runs.push(run);
			run = [];
		}
		run.push(point);
	}
	if (run.length > 1) runs.push(run);
	return runs;
}
