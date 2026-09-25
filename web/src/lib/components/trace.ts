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

/**
 * A run thinned to its low and high in each bucket of `bucketSeconds`, in
 * time order (#2878). A 2 h ride is 7 200 points against a graph about a
 * thousand units wide, rebuilt every second; two points per unit keep every
 * peak and trough the eye can see. A run that already fits comes back as it
 * was.
 */
export function thinRun(
	run: TracePoint[],
	bucketSeconds: number,
): TracePoint[] {
	if (bucketSeconds <= 1 || run.length <= 2) return run;
	const out: TracePoint[] = [];
	let bucket = Number.NaN;
	let low = run[0];
	let high = run[0];
	const flush = () => {
		if (low === high) out.push(low);
		else if (low.t < high.t) out.push(low, high);
		else out.push(high, low);
	};
	for (const point of run) {
		const b = Math.floor(point.t / bucketSeconds);
		if (b !== bucket) {
			if (!Number.isNaN(bucket)) flush();
			bucket = b;
			low = high = point;
		} else if (point.w < low.w) low = point;
		else if (point.w > high.w) high = point;
	}
	flush();
	return out;
}
