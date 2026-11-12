/**
 * The perf overlay's arithmetic (#4541), kept free of the browser so it is
 * tested: quantiles, and an aggregator that holds the last few seconds of
 * page frames, long tasks and named spans and sums them up on demand.
 */

/** The q-quantile of xs, nearest rank: what world-bench.mjs reports too. NaN for none. */
export function quantile(xs: readonly number[], q: number): number {
	if (xs.length === 0) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

/** One named span's last window: how often it ran and what each run cost. */
export type SpanSummary = {
	name: string;
	/** Runs a second. */
	rate: number;
	/** ms a run, median and 95th percentile. */
	p50: number;
	p95: number;
	max: number;
	/** ms a second spent in it: its share of the main thread. */
	perSecond: number;
};

export type PerfSummary = {
	/** The window it covers, ms: shorter than asked while the page is young. */
	windowMs: number;
	/** Animation frames a second, and the interval between them, ms. */
	fps: number;
	frame: { p50: number; p95: number; max: number };
	/** Long tasks (over 50 ms) in the window. */
	longTasks: { count: number; ms: number; max: number };
	/** Busiest first. */
	spans: SpanSummary[];
};

type Sample = { at: number; ms: number };

/**
 * Keeps `windowMs` of samples, each stamped with when it ended
 * (performance.now()), and forgets older ones as new ones arrive or a
 * summary is asked for.
 */
export function createAggregator(windowMs = 5000) {
	const frames: number[] = [];
	const longTasks: Sample[] = [];
	const spans = new Map<string, Sample[]>();
	let first = Infinity;

	function prune(now: number) {
		const from = now - windowMs;
		while (frames.length && frames[0] < from) frames.shift();
		while (longTasks.length && longTasks[0].at < from) longTasks.shift();
		for (const list of spans.values())
			while (list.length && list[0].at < from) list.shift();
	}
	const seen = (at: number) => {
		if (at < first) first = at;
	};

	return {
		/** An animation frame began at `at`. */
		frame(at: number) {
			seen(at);
			frames.push(at);
			if (frames.length > 2048) frames.shift();
		},
		longTask(ms: number, at: number) {
			seen(at - ms);
			longTasks.push({ at, ms });
		},
		/** `name` ran for `ms`, ending at `at`. */
		span(name: string, ms: number, at: number) {
			seen(at - ms);
			let list = spans.get(name);
			if (!list) spans.set(name, (list = []));
			list.push({ at, ms });
			if (list.length > 4096) list.shift();
		},
		summary(now: number): PerfSummary {
			prune(now);
			const covered = Math.min(windowMs, Math.max(0, now - first));
			const seconds = covered / 1000;
			const per = (n: number) => (seconds > 0 ? n / seconds : 0);
			const gaps = frames.slice(1).map((t, i) => t - frames[i]);
			const out: SpanSummary[] = [];
			for (const [name, list] of spans) {
				if (list.length === 0) continue;
				const ms = list.map((s) => s.ms);
				const total = ms.reduce((a, b) => a + b, 0);
				out.push({
					name,
					rate: per(list.length),
					p50: quantile(ms, 0.5),
					p95: quantile(ms, 0.95),
					max: Math.max(...ms),
					perSecond: per(total),
				});
			}
			out.sort((a, b) => b.perSecond - a.perSecond);
			return {
				windowMs: covered,
				fps: per(Math.max(0, frames.length - 1)),
				frame: {
					p50: quantile(gaps, 0.5),
					p95: quantile(gaps, 0.95),
					max: gaps.length ? Math.max(...gaps) : NaN,
				},
				longTasks: {
					count: longTasks.length,
					ms: longTasks.reduce((a, t) => a + t.ms, 0),
					max: longTasks.length ? Math.max(...longTasks.map((t) => t.ms)) : 0,
				},
				spans: out,
			};
		},
	};
}

export type Aggregator = ReturnType<typeof createAggregator>;

/** The video elements' playback, read twice: frames decoded and dropped a second between them. */
export type VideoReading = {
	width: number;
	height: number;
	frames: number;
	dropped: number;
};

export type VideoSummary = {
	/** Videos with a picture. */
	playing: number;
	/** Decoded frames a second, all videos together. */
	fps: number;
	dropped: number;
	/** The largest picture, in megapixels. */
	mp: number;
};

/** What the page's videos did between two readings `seconds` apart; a video new since `before` counts from zero. */
export function videoDelta(
	before: ReadonlyMap<unknown, VideoReading>,
	after: ReadonlyMap<unknown, VideoReading>,
	seconds: number,
): VideoSummary {
	let playing = 0;
	let frames = 0;
	let dropped = 0;
	let mp = 0;
	for (const [key, v] of after) {
		if (v.width === 0) continue;
		playing++;
		const b = before.get(key);
		frames += Math.max(0, v.frames - (b?.frames ?? v.frames));
		dropped += Math.max(0, v.dropped - (b?.dropped ?? v.dropped));
		mp = Math.max(mp, (v.width * v.height) / 1e6);
	}
	const per = (n: number) => (seconds > 0 ? n / seconds : 0);
	return { playing, fps: per(frames), dropped: per(dropped), mp };
}
