// `make perf` (#3039): what one element of the app costs in GPU and CPU, per
// display. Opens /dev/perf?case=… over each display's work area, lets it
// settle, then reads the cumulative GPU and CPU clocks of the page's own
// processes and of WindowServer across a few short samples and keeps the
// median. `make perf-scenes` measures whole screens instead (scenes.js);
// docs/PERFORMANCE.md says how to run both and how to read them.
//
// Electron, not a browser: the shell is how most riders run WattRoom on a
// desk, and this is the same Chromium it ships.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const perf = require('./sample');

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

perf.quietApp('wattroom-perf-profile');

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

/** The page says it is ready — or that it does not know the case — through
 *  its title; the load event comes before SvelteKit has mounted the route. */
async function ready(win, title, what) {
	const deadline = Date.now() + 15_000;
	while (!win.webContents.getTitle().startsWith('perf:')) {
		if (Date.now() > deadline) throw new Error(`${what} never rendered`);
		await perf.sleep(100);
	}
	if (win.webContents.getTitle() !== title)
		throw new Error(`/dev/perf does not know ${what}`);
}

/** One case, measured. */
async function measure(win, spec, noise) {
	const remote = /^(screen-share|camera)\b/.test(spec);
	const viewer = perf.load(win, `${perf.BASE}/dev/perf?case=${spec}`);
	let sender = null;
	if (remote) {
		sender = new BrowserWindow({
			show: false,
			webPreferences: { backgroundThrottling: false },
		});
		await perf.load(sender, `${perf.BASE}/dev/perf/send?case=${spec}`);
	}
	await viewer;
	await ready(win, 'perf:ready', `the case "${spec}"`);
	if (sender) {
		await ready(sender, 'perf:sender', `the sender for "${spec}"`);
		const offer = await sender.webContents.executeJavaScript('perfMakeOffer()');
		const answer = await win.webContents.executeJavaScript(
			`perfAcceptOffer(${JSON.stringify(offer)})`,
		);
		await sender.webContents.executeJavaScript(
			`perfAcceptAnswer(${JSON.stringify(answer)})`,
		);
	}
	await perf.sleep(
		spec.startsWith('youtube') ? perf.SETTLE_MS + 6000 : perf.SETTLE_MS,
	);

	const hasVideo = remote || spec.startsWith('youtube');
	const video0 = hasVideo
		? await win.webContents.executeJavaScript('perfVideo()')
		: [];
	const v0 = performance.now();
	const exclude = sender ? [sender.webContents.getOSProcessId()] : [];
	const result = {
		case: spec,
		...(await perf.sampleApp(win, { exclude, noise })),
	};
	if (hasVideo) {
		const video1 = await win.webContents.executeJavaScript('perfVideo()');
		const secs = (performance.now() - v0) / 1000;
		result.video = video1
			.map(
				(v, i) =>
					`${v.size} ${perf.round((v.frames - (video0[i]?.frames ?? 0)) / secs)} fps`,
			)
			.join(', ');
	}
	sender?.destroy();
	return result;
}

perf.start('perf', async () => {
	fs.mkdirSync(perf.OUT, { recursive: true });
	const jsonl = fs.createWriteStream(path.join(perf.OUT, 'results.jsonl'));
	const sections = [];
	for (const display of perf.selectDisplays()) {
		const specs = withBaselines(CASES);
		const minutes =
			(specs.length * (perf.SETTLE_MS + perf.SAMPLES * perf.SAMPLE_MS + 800)) /
			60000;
		console.log(
			`\n${display.label}: ${CASES.length} cases, about ${perf.round(minutes)} min`,
		);
		const win = new BrowserWindow({
			...display.workArea,
			alwaysOnTop: true,
			backgroundColor: '#0a0118',
			webPreferences: { backgroundThrottling: false },
		});
		win.setAlwaysOnTop(true, 'floating');
		// Unrecorded: the first load of a fresh window pays for the window.
		await perf.load(win, `${perf.BASE}/dev/perf?case=none`);
		await perf.sleep(perf.SETTLE_MS);
		const results = [];
		const noise = [];
		for (const spec of specs) {
			const r = await measure(win, spec, results.length === 0 ? noise : null);
			results.push(r);
			jsonl.write(JSON.stringify({ display: display.label, ...r }) + '\n');
			console.log(perf.progress(spec, r));
		}
		win.destroy();
		sections.push(perf.report(display, results, noise));
		// After every display, so a run that fails later keeps what it measured.
		fs.writeFileSync(
			path.join(perf.OUT, 'report.md'),
			sections.join('\n\n') + '\n',
		);
	}
	console.log(`\n${sections.join('\n\n')}\n\nWritten to ${perf.OUT}/report.md`);
	jsonl.end(() => app.quit());
});
