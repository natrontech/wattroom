// What both perf runners share (#3039): the settings, the sampler that turns
// two snapshots of the GPU and CPU clocks into percentages, and the report.
const { app, screen } = require('electron');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { gpuNanos, cpuSeconds } = require('./counters');

const BASE = (process.env.PERF_URL ?? '').replace(/\/$/, '');
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 1500);
// One-second samples scatter by about ±0.5% GPU on a quiet machine; CPU
// is coarser, because ps counts in centiseconds.
const SAMPLE_MS = Number(process.env.PERF_SAMPLE_MS ?? 1000);
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 3);
const OUT =
	process.env.PERF_OUT ?? path.join(os.tmpdir(), `wattroom-perf-${Date.now()}`);
const WINDOW_SERVER = Number(
	execFileSync('pgrep', ['-x', 'WindowServer']).toString().trim(),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (x) => Math.round(x * 10) / 10;
const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length % 2
		? s[(s.length - 1) / 2]
		: (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Everything the measured window draws is heard by nobody. */
function quietApp(profile) {
	app.commandLine.appendSwitch('mute-audio');
	app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
	app.setPath('userData', path.join(os.tmpdir(), profile));
	// Between two displays no window is open, and Electron quits when that
	// happens unless told otherwise — which ended a run after its first display.
	app.on('window-all-closed', () => {});
}

/** A load that survives a bad navigation: one lost page must not cost the
 *  displays still to come. */
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

/** The displays PERF_DISPLAYS names (substrings of the label, or ids). */
function selectDisplays() {
	const wanted = process.env.PERF_DISPLAYS?.toLowerCase();
	return screen
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
}

/**
 * SAMPLES windows of SAMPLE_MS over this app's own processes and WindowServer,
 * reduced to medians. `exclude` takes pids out of the app's own (a sender
 * window that shares the process tree). `noise`, when given, collects the
 * other processes that used the GPU during the first sample.
 */
async function sampleApp(win, { exclude = [], noise = null } = {}) {
	const cdp = win.webContents.debugger;
	if (!cdp.isAttached()) cdp.attach('1.3');
	await cdp.sendCommand('Performance.enable');
	const taskSeconds = async () =>
		(await cdp.sendCommand('Performance.getMetrics')).metrics.find(
			(m) => m.name === 'TaskDuration',
		).value;
	const rows = [];
	for (let i = 0; i < SAMPLES; i++) {
		const metrics = app.getAppMetrics().filter((m) => !exclude.includes(m.pid));
		const of = (type) =>
			metrics.filter((m) => m.type === type).map((m) => m.pid);
		const gpuPids = of('GPU');
		const rendererPids = of('Tab');
		const everyPid = [...metrics.map((m) => m.pid), WINDOW_SERVER];
		const g0 = gpuNanos();
		const c0 = cpuSeconds(everyPid);
		const m0 = await taskSeconds();
		const t0 = performance.now();
		await sleep(SAMPLE_MS);
		const g1 = gpuNanos();
		const c1 = cpuSeconds(everyPid);
		const m1 = await taskSeconds();
		const secs = (performance.now() - t0) / 1000;
		const gpuPct = (pids) =>
			(pids.reduce(
				(s, p) => s + ((g1.byPid.get(p) ?? 0) - (g0.byPid.get(p) ?? 0)),
				0,
			) /
				(secs * 1e9)) *
			100;
		const cpuPct = (pids) =>
			(pids.reduce((s, p) => s + ((c1.get(p) ?? 0) - (c0.get(p) ?? 0)), 0) /
				secs) *
			100;
		rows.push({
			gpu: gpuPct(gpuPids),
			cpuRenderer: cpuPct(rendererPids),
			cpuGpuProcess: cpuPct(gpuPids),
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
	const result = {
		samples: rows.map((r) =>
			Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)])),
		),
	};
	for (const key of Object.keys(rows[0]))
		result[key] = round(median(rows.map((r) => r[key])));
	result.gpuSpread = round(
		Math.max(...rows.map((r) => r.gpu)) - Math.min(...rows.map((r) => r.gpu)),
	);
	return result;
}

/** One display's section: its configuration, how steady it was, the table. */
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

/** The line printed while a run goes, so a watcher sees it move. */
function progress(label, r) {
	return `  ${label.padEnd(30)} GPU ${String(r.gpu).padStart(5)}%  CPU ${String(round(r.cpuRenderer + r.cpuGpuProcess)).padStart(5)}%${r.video ? `  ${r.video}` : ''}`;
}

/** A runner's entry point: PERF_URL checked, failures loud and non-zero. */
function start(name, run) {
	app
		.whenReady()
		.then(() => {
			if (!BASE)
				throw new Error(
					`PERF_URL is not set — run it through \`make ${name}\`, which points it at this checkout's Vite.`,
				);
			return run();
		})
		.catch((err) => {
			console.error(`make ${name}: ${err.message}`);
			app.exit(1);
		});
}

module.exports = {
	BASE,
	SETTLE_MS,
	SAMPLE_MS,
	SAMPLES,
	OUT,
	sleep,
	round,
	quietApp,
	load,
	selectDisplays,
	sampleApp,
	report,
	progress,
	start,
};
