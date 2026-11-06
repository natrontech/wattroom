export interface TracePoint {
	/** workout-clock seconds — NOT contiguous: skip jumps it forward. */
	t: number;
	w: number;
	/**
	 * Heart rate that second, bpm (#4426): absent while no strap reports one,
	 * so the heart line breaks where the strap went quiet.
	 */
	h?: number;
}

/**
 * Split a power trace into continuously-ridden runs.
 *
 * The trace is keyed on workout-clock time so it lines up with the interval graph,
 * but that clock jumps: skip moves it forward over ground the rider never covered,
 * and a clock that ran back (as +1 min did before #4445) re-rides ground. Drawing
 * one polyline across either is a lie — forward jumps invent a straight line through work that
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
	value: (point: TracePoint) => number = (point) => point.w,
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
		} else if (value(point) < value(low)) low = point;
		else if (value(point) > value(high)) high = point;
	}
	flush();
	return out;
}

/**
 * The heart rate's runs (#4426): the trace's runs cut again wherever a
 * second carries no heart rate, so a strap that dropped out draws a gap and
 * never a line to zero.
 */
export function heartRuns(
	trace: TracePoint[],
	maxGapSeconds = 3,
): TracePoint[][] {
	const runs: TracePoint[][] = [];
	for (const run of splitTrace(trace, maxGapSeconds)) {
		let part: TracePoint[] = [];
		for (const point of run) {
			if (point.h && point.h > 0) part.push(point);
			else {
				if (part.length > 1) runs.push(part);
				part = [];
			}
		}
		if (part.length > 1) runs.push(part);
	}
	return runs;
}

/**
 * Where a heart rate stands on the graph (#4426), as a fraction of the
 * power axis's FTP so it shares the graph's height on a scale of its own:
 * half the anchor on the floor, the anchor on the FTP line. The anchor is
 * the rider's LTHR, so the dashed line is both thresholds.
 */
export function heartFraction(bpm: number, anchor: number): number {
	if (anchor <= 0) return 0;
	return Math.max(0, (2 * bpm) / anchor - 1);
}

/**
 * The heart axis with no LTHR set (#4426): 170 bpm on the FTP line, so 85
 * on the floor and about 210 at the graph's top, the profile's LTHR bounds
 * (docs/spec/stats.md). It places the line and claims no threshold. The
 * ride's own peak was rejected: it pinned a 110 bpm warm-up to the FTP line.
 */
export const HEART_AXIS_BPM = 170;

/** The heart line's anchor: LTHR when set, else the axis's stand-in. */
export function heartAnchor(lthr?: number): number {
	return lthr && lthr > 0 ? lthr : HEART_AXIS_BPM;
}

/** One second of the trace; a heart rate rides along only while one reports. */
export function tracePoint(t: number, w: number, hr?: number): TracePoint {
	return hr && hr > 0 ? { t, w, h: Math.round(hr) } : { t, w };
}
