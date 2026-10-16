/**
 * The soak's verdict (#3851, docs/spec/world.md "Soak"): a world ridden for
 * hours stays flat. No metric's mean over the last window may exceed its
 * mean over the first by more than GROWTH; the textures and geometries never
 * climb past the ceiling the first window held; the ground never holds more
 * chunks than its streamer means to.
 */

/** One simulated minute's reading. */
export type Sample = {
	minute: number;
	wallS: number;
	km: number;
	heapMB: number;
	geometries: number;
	textures: number;
	programs: number;
	draws: number;
	triangles: number;
	groundHeld: number;
	groundWindow: number;
	listeners: number;
	intervals: number;
	timeouts: number;
	frames: number;
	/** Rendered frames this minute, and the ms between their starts and of their JS. */
	rendered: number;
	frameP50: number;
	frameP95: number;
	costP50: number;
	costP95: number;
	/** Frames that began more than two 30 fps intervals after the one before. */
	hitches: number;
};

/** docs/spec/world.md "Soak": the last window's mean at most 10 % over the first's. */
const GROWTH = 0.1;
/** Simulated minutes in each window; a shorter soak takes a third of its length. */
const WINDOW_MIN = 30;
/** A count's growth under one whole handle or object is noise, not a trend. */
const COUNT_SLACK = 1;

/**
 * What the gate compares, whether it is a count, and whether it is a frame
 * time: those wait for a GPU, since software GL's frames time the machine's
 * other work as much as the world's.
 */
const GATED: { key: keyof Sample; count: boolean; frame?: true }[] = [
	{ key: 'heapMB', count: false },
	{ key: 'geometries', count: true },
	{ key: 'textures', count: true },
	{ key: 'programs', count: true },
	{ key: 'listeners', count: true },
	{ key: 'intervals', count: true },
	{ key: 'timeouts', count: true },
	{ key: 'frames', count: true },
	{ key: 'groundHeld', count: true },
	{ key: 'frameP50', count: false, frame: true },
	{ key: 'frameP95', count: false, frame: true },
];

type Row = {
	metric: string;
	first: number;
	last: number;
	growth: number;
	ok: boolean;
};

type Verdict = {
	ok: boolean;
	window: number;
	/** False when the frames were drawn in software: reported, not judged. */
	framesJudged: boolean;
	rows: Row[];
	/** Each failure in a line. */
	failures: string[];
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x: number) => Math.round(x * 100) / 100;

export function windowFor(minutes: number): number {
	return Math.max(1, Math.min(WINDOW_MIN, Math.floor(minutes / 3)));
}

export function judge(
	samples: readonly Sample[],
	minutes: number,
	{ software = false } = {},
): Verdict {
	const window = windowFor(minutes);
	const framesJudged = !software;
	// Minute 0 is the world still compiling and streaming its first ground.
	const first = samples.filter((s) => s.minute >= 1 && s.minute <= window);
	const last = samples.filter((s) => s.minute > minutes - window);
	const failures: string[] = [];
	if (first.length === 0 || last.length === 0)
		return {
			ok: false,
			window,
			framesJudged,
			rows: [],
			failures: [`too few samples: ${samples.length} over ${minutes} minutes`],
		};
	const rows = GATED.map(({ key, count, frame }) => {
		const a = mean(first.map((s) => s[key]));
		const b = mean(last.map((s) => s[key]));
		const allowed = a * (1 + GROWTH) + (count ? COUNT_SLACK : 0);
		const ok = b <= allowed || (!!frame && !framesJudged);
		if (!ok)
			failures.push(
				`${key}: the last ${window} minutes average ${round(b)}, the first ${round(a)} (at most ${round(allowed)})`,
			);
		return {
			metric: key,
			first: round(a),
			last: round(b),
			growth: a > 0 ? round((b - a) / a) : b > 0 ? Infinity : 0,
			ok,
		};
	});
	for (const key of ['textures', 'geometries'] as const) {
		const ceiling = Math.max(...first.map((s) => s[key]));
		const top = Math.max(...last.map((s) => s[key]));
		if (top > ceiling * (1 + GROWTH) + COUNT_SLACK)
			failures.push(
				`${key}: reached ${top} in the last ${window} minutes, past the first window's ceiling of ${ceiling}`,
			);
	}
	for (const s of samples)
		if (s.groundHeld > s.groundWindow) {
			failures.push(
				`ground: ${s.groundHeld} chunks held at minute ${s.minute}, where the streamer means at most ${s.groundWindow}`,
			);
			break;
		}
	return { ok: failures.length === 0, window, framesJudged, rows, failures };
}

/** The run in a page of numbers: what docs/PERFORMANCE.md keeps. */
export function report(
	samples: readonly Sample[],
	minutes: number,
	speed: number,
	verdict: Verdict,
): string {
	const end = samples.at(-1);
	const head = [
		`# World soak`,
		'',
		`${minutes} simulated minutes at ${speed}×, ${end ? `${end.km.toFixed(1)} km in ${Math.round(end.wallS / 60)} minutes of wall time` : 'no samples'}; windows of ${verdict.window} minutes.`,
		'',
		verdict.ok
			? '**Flat.**'
			: `**Not flat:**\n\n${verdict.failures.map((f) => `- ${f}`).join('\n')}`,
		'',
		'| metric | first window | last window | growth | |',
		'|---|---|---|---|---|',
		...verdict.rows.map(
			(r) =>
				`| ${r.metric} | ${r.first} | ${r.last} | ${Number.isFinite(r.growth) ? `${Math.round(r.growth * 100)} %` : '∞'} | ${r.ok ? 'ok' : '**over**'} |`,
		),
	];
	const cols: (keyof Sample)[] = [
		'minute',
		'km',
		'heapMB',
		'geometries',
		'textures',
		'programs',
		'groundHeld',
		'groundWindow',
		'listeners',
		'intervals',
		'timeouts',
		'frames',
		'rendered',
		'frameP50',
		'frameP95',
		'costP95',
		'hitches',
	];
	const every = Math.max(1, Math.round(samples.length / 24));
	const table = [
		'',
		`Every ${every === 1 ? '' : `${every}th `}sample:`,
		'',
		`| ${cols.join(' | ')} |`,
		`|${cols.map(() => '---').join('|')}|`,
		...samples
			.filter((_, i) => i % every === 0 || i === samples.length - 1)
			.map((s) => `| ${cols.map((c) => round(s[c])).join(' | ')} |`),
	];
	return [...head, ...table, ''].join('\n');
}
