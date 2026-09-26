// `make perf` (#3039): what one element of the app costs in GPU and CPU, per
// display. Opens /dev/perf?case=… over each display's work area, lets it
// settle, then reads the cumulative GPU and CPU clocks of the page's own
// processes and of WindowServer across a few short samples and keeps the
// median. docs/PERFORMANCE.md says how to run it and how to read it.
//
// Electron, not a browser: the shell is how most riders run WattRoom on a
// desk, and this is the same Chromium it ships.
const { app, BrowserWindow, screen } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gpuNanos, cpuSeconds } = require('./counters');

const BASE = (process.env.PERF_URL ?? '').replace(/\/$/, '');
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 1500);
// One-second samples scatter by about ±0.5% GPU on a quiet machine; CPU
// is coarser, because ps counts in centiseconds (#3039).
const SAMPLE_MS = Number(process.env.PERF_SAMPLE_MS ?? 1000);
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 3);
const OUT =
	process.env.PERF_OUT ?? path.join(os.tmpdir(), `wattroom-perf-${Date.now()}`);

// What earned its place: every element that animates without end, the share
// at the rate a real one arrived (6) and at LiveKit's ceiling (15), the
// stage's blurred zoom bar on its own, and a camera. `youtube` needs the
// network and is opt-in through PERF_CASES.
const DEFAULT_CASES = [
	'riding-bars&n=1',
	'riding-bars&n=4',
	'avatar-riding&n=1',
	'logo-live',
	'speaking-mic&n=1',
	'status-dot',
	'live-dot',
	'skeleton&n=6',
	'screen-share&fps=6',
	'screen-share&fps=15',
	'screen-share&fps=15&bar=0',
	'camera&n=1',
];
const CASES =
	process.env.PERF_CASES?.split(/\s+/).filter(Boolean) ?? DEFAULT_CASES;
/** A baseline this often, so drift over the run shows instead of hiding. */
const BASELINE_EVERY = 5;

app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setPath('userData', path.join(os.tmpdir(), 'wattroom-perf-profile'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length % 2
		? s[(s.length - 1) / 2]
		: (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (x) => Math.round(x * 10) / 10;
const WINDOW_SERVER = Number(
	execFileSync('pgrep', ['-x', 'WindowServer']).toString().trim(),
);

function withBaselines(cases) {
	const out = ['none'];
	cases.forEach((c, i) => {
		out.push(c);
		if ((i + 1) % BASELINE_EVERY === 0 && i + 1 < cases.length)
			out.push('none');
	});
	out.push('none');
	return out;
}

/**
 * A load that survives a bad navigation: one lost page must not cost the
 * displays still to come.
 */
async function load(win, url) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await win.loadURL(url);
		} catch (err) {
			if (attempt === 3) throw err;
			await sleep(1000);
		}
	}
}

/** One case, measured: its medians over SAMPLES windows of SAMPLE_MS. */
async function measure(win, spec, { noise }) {
	const remote = /^(screen-share|camera)\b/.test(spec);
	const viewer = load(win, `${BASE}/dev/perf?case=${spec}`);
	let sender = null;
	if (remote) {
		sender = new BrowserWindow({
			show: false,
			webPreferences: { backgroundThrottling: false },
		});
		await load(sender, `${BASE}/dev/perf/send?case=${spec}`);
	}
	await viewer;
	// The load event comes before SvelteKit has mounted the route; the page
	// says it is ready — or that it does not know the case — through its title.
	const deadline = Date.now() + 15_000;
	while (!win.webContents.getTitle().startsWith('perf:')) {
		if (Date.now() > deadline)
			throw new Error(`/dev/perf never rendered "${spec}"`);
		await sleep(100);
	}
	if (win.webContents.getTitle() !== 'perf:ready')
		throw new Error(`/dev/perf does not know the case "${spec}"`);
	while (sender && sender.webContents.getTitle() !== 'perf:sender') {
		if (Date.now() > deadline)
			throw new Error(`/dev/perf/send never rendered "${spec}"`);
		await sleep(100);
	}
	if (sender) {
		const offer = await sender.webContents.executeJavaScript('perfMakeOffer()');
		const answer = await win.webContents.executeJavaScript(
			`perfAcceptOffer(${JSON.stringify(offer)})`,
		);
		await sender.webContents.executeJavaScript(
			`perfAcceptAnswer(${JSON.stringify(answer)})`,
		);
	}
	const cdp = win.webContents.debugger;
	await cdp.sendCommand('Performance.enable');
	await sleep(spec.startsWith('youtube') ? SETTLE_MS + 6000 : SETTLE_MS);

	const senderPid = sender?.webContents.getOSProcessId();
	const own = () => {
		const metrics = app.getAppMetrics().filter((m) => m.pid !== senderPid);
		const of = (type) =>
			metrics.filter((m) => m.type === type).map((m) => m.pid);
		return {
			gpu: of('GPU'),
			renderer: of('Tab'),
			all: metrics.map((m) => m.pid),
		};
	};
	const taskSeconds = async () =>
		(await cdp.sendCommand('Performance.getMetrics')).metrics.find(
			(m) => m.name === 'TaskDuration',
		).value;

	const hasVideo = remote || spec.startsWith('youtube');
	const video0 = hasVideo
		? await win.webContents.executeJavaScript('perfVideo()')
		: [];
	const v0 = performance.now();
	const rows = [];
	for (let i = 0; i < SAMPLES; i++) {
		const pids = own();
		const everyPid = [...pids.all, WINDOW_SERVER];
		const g0 = gpuNanos();
		const c0 = cpuSeconds(everyPid);
		const m0 = await taskSeconds();
		const t0 = performance.now();
		await sleep(SAMPLE_MS);
		const g1 = gpuNanos();
		const c1 = cpuSeconds(everyPid);
		const m1 = await taskSeconds();
		const secs = (performance.now() - t0) / 1000;
		const gpuPct = (list) =>
			(list.reduce(
				(s, p) => s + ((g1.byPid.get(p) ?? 0) - (g0.byPid.get(p) ?? 0)),
				0,
			) /
				(secs * 1e9)) *
			100;
		const cpuPct = (list) =>
			(list.reduce((s, p) => s + ((c1.get(p) ?? 0) - (c0.get(p) ?? 0)), 0) /
				secs) *
			100;
		rows.push({
			gpu: gpuPct(pids.gpu),
			cpuRenderer: cpuPct(pids.renderer),
			cpuGpuProcess: cpuPct(pids.gpu),
			mainThreadMsPerSec: ((m1 - m0) / secs) * 1000,
			windowServerGpu: gpuPct([WINDOW_SERVER]),
			windowServerCpu: cpuPct([WINDOW_SERVER]),
		});
		if (noise && i === 0) {
			const mine = new Set(everyPid);
			noise.push(
				...[...g1.byPid]
					.filter(([pid]) => !mine.has(pid))
					.map(([pid, n]) => ({
						name: g1.names.get(pid),
						gpu: round(((n - (g0.byPid.get(pid) ?? 0)) / (secs * 1e9)) * 100),
					}))
					.filter((p) => p.gpu >= 0.5)
					.sort((a, b) => b.gpu - a.gpu)
					.slice(0, 5),
			);
		}
	}
	const result = { case: spec };
	result.samples = rows.map((r) =>
		Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)])),
	);
	for (const key of Object.keys(rows[0]))
		result[key] = round(median(rows.map((r) => r[key])));
	result.gpuSpread = round(
		Math.max(...rows.map((r) => r.gpu)) - Math.min(...rows.map((r) => r.gpu)),
	);
	if (hasVideo) {
		const video1 = await win.webContents.executeJavaScript('perfVideo()');
		const secs = (performance.now() - v0) / 1000;
		result.video = video1
			.map(
				(v, i) =>
					`${v.size} ${round((v.frames - (video0[i]?.frames ?? 0)) / secs)} fps`,
			)
			.join(', ');
	}
	sender?.destroy();
	return result;
}

function report(display, results, noise) {
	const baselines = results.filter((r) => r.case === 'none');
	const base = {
		gpu: median(baselines.map((r) => r.windowServerGpu)),
		cpu: median(baselines.map((r) => r.windowServerCpu)),
	};
	const spread = (key) =>
		Math.max(...baselines.map((r) => r[key])) -
		Math.min(...baselines.map((r) => r[key]));
	// Past these, another app's redraws are larger than most effects measured
	// here, and the WindowServer columns stop meaning anything.
	const steadyGpu = spread('windowServerGpu') <= 2;
	const steadyCpu = spread('windowServerCpu') <= 5;
	const px = `${display.size.width * display.scaleFactor}×${display.size.height * display.scaleFactor}`;
	const lines = [
		`### ${display.label}`,
		'',
		`${display.size.width}×${display.size.height} pt at ${display.scaleFactor}× (${px} px), ${Math.round(display.displayFrequency)} Hz. ` +
			`Settle ${SETTLE_MS} ms, median of ${SAMPLES} × ${SAMPLE_MS} ms.`,
		'',
		`WindowServer baseline: GPU ${round(base.gpu)}% (spread ${round(spread('windowServerGpu'))}), ` +
			`CPU ${round(base.cpu)}% (spread ${round(spread('windowServerCpu'))}).` +
			(steadyGpu && steadyCpu
				? ''
				: ' **Not steady — its Δ columns are marked `~` and are noise.**'),
		noise.length
			? `Other GPU users during the first baseline: ${noise.map((p) => `${p.name} ${p.gpu}%`).join(', ')}.`
			: 'No other process used the GPU during the first baseline.',
		'',
		'| case | GPU % (spread) | renderer CPU % | GPU-process CPU % | main thread ms/s | WindowServer GPU Δ | WindowServer CPU Δ | video |',
		'|---|---|---|---|---|---|---|---|',
	];
	for (const r of results) {
		const ws = (value, baseline, steady) =>
			`${steady ? '' : '~'}${round(value - baseline)}`;
		lines.push(
			`| ${r.case} | ${r.gpu} (${r.gpuSpread}) | ${r.cpuRenderer} | ${r.cpuGpuProcess} | ${r.mainThreadMsPerSec} | ` +
				`${ws(r.windowServerGpu, base.gpu, steadyGpu)} | ${ws(r.windowServerCpu, base.cpu, steadyCpu)} | ${r.video ?? ''} |`,
		);
	}
	return lines.join('\n');
}

app
	.whenReady()
	.then(run)
	.catch((err) => {
		console.error(`make perf: ${err.message}`);
		app.exit(1);
	});

async function run() {
	if (!BASE) {
		console.error(
			'PERF_URL is not set — run it through `make perf`, which points it at this checkout’s Vite.',
		);
		app.exit(2);
		return;
	}
	const wanted = process.env.PERF_DISPLAYS?.toLowerCase();
	const displays = screen
		.getAllDisplays()
		.filter(
			(d) =>
				!wanted ||
				wanted === 'all' ||
				wanted
					.split(',')
					.some(
						(w) =>
							d.label.toLowerCase().includes(w.trim()) ||
							String(d.id) === w.trim(),
					),
		);
	fs.mkdirSync(OUT, { recursive: true });
	const jsonl = fs.createWriteStream(path.join(OUT, 'results.jsonl'));
	const sections = [];
	for (const display of displays) {
		console.log(
			`\n${display.label}: ${CASES.length} cases, about ${Math.round(((withBaselines(CASES).length * (SETTLE_MS + SAMPLES * SAMPLE_MS + 800)) / 60000) * 10) / 10} min`,
		);
		const win = new BrowserWindow({
			...display.workArea,
			alwaysOnTop: true,
			backgroundColor: '#0a0118',
			webPreferences: { backgroundThrottling: false },
		});
		win.setAlwaysOnTop(true, 'floating');
		win.webContents.debugger.attach('1.3');
		// Unrecorded: the first load of a fresh window pays for the window.
		await load(win, `${BASE}/dev/perf?case=none`);
		await sleep(SETTLE_MS);
		const results = [];
		const noise = [];
		for (const spec of withBaselines(CASES)) {
			const r = await measure(win, spec, {
				noise: results.length === 0 ? noise : null,
			});
			results.push(r);
			jsonl.write(JSON.stringify({ display: display.label, ...r }) + '\n');
			console.log(
				`  ${spec.padEnd(28)} GPU ${String(r.gpu).padStart(5)}%  CPU ${String(round(r.cpuRenderer + r.cpuGpuProcess)).padStart(5)}%${r.video ? `  ${r.video}` : ''}`,
			);
		}
		win.destroy();
		sections.push(report(display, results, noise));
		// After every display, so a run that fails later keeps what it measured.
		fs.writeFileSync(path.join(OUT, 'report.md'), sections.join('\n\n') + '\n');
	}
	jsonl.end();
	console.log(`\n${sections.join('\n\n')}\n\nWritten to ${OUT}/report.md`);
	app.quit();
}
