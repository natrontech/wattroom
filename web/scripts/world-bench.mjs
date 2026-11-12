// The world's frame budget on software WebGL (#3082), run by `make world-bench`
// and `make voice-bench`.
//
// WATTROOM.md: a gate that would need someone's hardware is met by a
// simulation. The slow rig is headless Chromium drawing WebGL on SwiftShader
// with the page's CPU throttled 4× (CDP), and stands for the low tier; the
// same run unthrottled is the reference beside it. Each scene prints frame
// time, missed vsync-divisor intervals, draws and triangles against
// docs/spec/world.md's tiers.
//
// Scenes (BENCH_SCENES, space-separated):
// - `world`: /dev/perf's world case, the real scene on the synthetic pass
//   loop with four riders and nothing else on the page. The default.
// - `ride`: /ride on the Pass loop in 3D, the simulated trainer riding: the
//   whole app around the world, solo.
// - `voice`: the same ride from a crew's voice channel, in voice (#4533).
// - `voice-standing`: the voice channel's ride before the first pedal
//   stroke, no trainer: what a rider without one sees.
// The app scenes load with `?perf` (#4541) and read the same numbers off
// the overlay's handle, plus the page's own frames, long tasks and the
// `wattroom:` spans.
//
// The throttle slows the page's own thread (the sim, culling, three.js
// submitting draws); SwiftShader rasterises in the GPU process, which no
// rate throttles. These are software-rig numbers, never a real device's.
import { chromium } from '@playwright/test';

const PORT = process.env.WATTROOM_DEV_WEB_PORT;
if (!PORT) {
	console.error(
		'WATTROOM_DEV_WEB_PORT is unset — run through `make world-bench`.',
	);
	process.exit(1);
}
const BASE = `http://localhost:${PORT}`;
const SECONDS = Number(process.env.BENCH_SECONDS ?? 60);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 15);
const [width, height] = (process.env.BENCH_VIEW ?? '1280x720')
	.split('x')
	.map(Number);
const VIEW = { width, height };
/** CSS pixels to device pixels: 2 is a Retina screen (BENCH_DPR=2). */
const DPR = Number(process.env.BENCH_DPR ?? 1);
/** The 3D look (Settings → Look): `diorama`, the default, or `smooth`. */
const LOOK = process.env.BENCH_LOOK ?? 'diorama';
if (LOOK !== 'diorama' && LOOK !== 'smooth') {
	console.error(`BENCH_LOOK is diorama or smooth, not ${LOOK}.`);
	process.exit(1);
}
/** The World control's Light, the lowest rung (BENCH_LIGHT=1). */
const LIGHT = process.env.BENCH_LIGHT === '1';
const SCENES = (process.env.BENCH_SCENES ?? 'world')
	.split(/\s+/)
	.filter(Boolean);
const KNOWN = ['world', 'ride', 'voice', 'voice-standing'];
for (const s of SCENES)
	if (!KNOWN.includes(s)) {
		console.error(`BENCH_SCENES takes ${KNOWN.join(', ')}; not ${s}.`);
		process.exit(1);
	}
/** CPU throttle rates, each a rig: `1 4` by default. */
const RATES = (process.env.BENCH_RATES ?? '1 4').split(/\s+/).map(Number);
/** Crew-mates in the voice channel with their camera on, for the voice scenes. */
const CAMS = Number(process.env.BENCH_CAMS ?? 0);
/** BENCH_PROFILE=1: a CPU profile of 10 s of each run, its busiest functions printed. */
const PROFILE = process.env.BENCH_PROFILE === '1';
/**
 * BENCH_GL=gpu draws on this machine's own GPU instead (headless Chromium
 * reaches it: Metal on macOS), for numbers that are a real screen's rather
 * than the software rig's. Still headless: no window opens.
 */
const GL = process.env.BENCH_GL ?? 'swiftshader';
if (GL !== 'swiftshader' && GL !== 'gpu') {
	console.error(`BENCH_GL is swiftshader or gpu, not ${GL}.`);
	process.exit(1);
}
const RIG = GL === 'gpu' ? 'GPU' : 'software';
const RIGS = RATES.map((rate) => ({
	name: rate === 1 ? RIG : `${RIG}, CPU ${rate}× slower`,
	rate,
}));
/** docs/spec/world.md, "The world": what each tier may draw. */
const TIERS = { high: [60, 400_000], low: [30, 150_000] };
/** The same file's Fallback, loop.ts's missWatch: the share of intervals missed over 10 s. */
const FALLBACK = 0.2;
/** desktop/perf/scenes.js's crew, so a machine that runs both keeps one. */
const CREW = 'Perf Bench';

/** The q-quantile of xs, nearest rank (src/lib/perf/stats.ts has the tested twin). */
const quantile = (xs, q) => {
	if (xs.length === 0) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

/** The page's own fetch, so the call carries its session cookie; throws on a refusal. */
async function api(page, method, url, body) {
	const res = await page.evaluate(
		async ([method, url, body]) => {
			const r = await fetch(url, {
				method,
				headers: { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			return { status: r.status, json: await r.json().catch(() => null) };
		},
		[method, url, body],
	);
	if (res.status >= 400)
		throw new Error(
			`${method} ${url}: ${res.status} ${JSON.stringify(res.json)}`,
		);
	return res.json;
}

/** Press the control a rider reads as `name`, once it is there. */
const press = (page, name, timeout = 30_000) =>
	page
		.getByRole('button', { name, exact: true })
		.or(page.getByRole('link', { name, exact: true }))
		.first()
		.click({ timeout });

/** The crew's voice channel and its invite code, the crew founded on first use. */
async function voiceChannel(page) {
	const mine = await api(page, 'GET', '/api/crews');
	let crew = mine.crews?.find((c) => c.name === CREW && c.role === 'owner');
	crew ??= await api(page, 'POST', '/api/crews', { name: CREW });
	const { code } = await api(page, 'GET', `/api/crews/${crew.id}`);
	const { channels } = await api(page, 'GET', `/api/crews/${crew.id}/channels`);
	const voice = channels.find((c) => c.kind === 'voice');
	if (!voice) throw new Error(`${CREW} has no voice channel`);
	return { code, path: `/crew/${crew.id}/v/${voice.id}` };
}

/** A browser context signed in as `name`, muted, its world at `mode`. */
async function rider(browser, name, mode) {
	const context = await browser.newContext({
		viewport: VIEW,
		deviceScaleFactor: DPR,
	});
	await context.addInitScript(
		([pixels, mode]) => {
			// AGENTS.md: mute before anything plays.
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			);
			// Software GL misses frames by design: the dev build's frame judge
			// stands down, so the world keeps drawing and its misses are counted here.
			localStorage.setItem('wattroom.world-software.v1', '1');
			localStorage.setItem('wattroom.world.pixels.v1', pixels);
			localStorage.setItem('wattroom.world.mode.v1', mode);
		},
		[LOOK === 'diorama' ? 'd' : '0', mode],
	);
	const page = await context.newPage();
	try {
		// The perf page lives in the app: signed out, it is sent to the sign-in page and its world goes.
		await page.goto(
			`${BASE}/api/auth/dev/start?as=${encodeURIComponent(name)}`,
		);
	} catch (err) {
		throw new Error(
			`Nothing answers on ${BASE}: start \`make dev-web\` first.`,
			{ cause: err },
		);
	}
	return { context, page };
}

/**
 * BENCH_CAMS: crew-mates in the call with their camera on (Chromium's fake
 * device), each its own context in the same browser, its world flat. Their
 * pages encode and the measured page decodes, as on ride night.
 */
async function joinCams(browser, n, voice) {
	const contexts = [];
	for (let i = 1; i <= n; i++) {
		const { context, page } = await rider(
			browser,
			`Bench Cam ${String.fromCharCode(64 + i)}`,
			'flat',
		);
		contexts.push(context);
		// Dev names are letters only: Bench Cam A, B, …. Idempotent: a member from an earlier run joins again.
		await api(page, 'POST', '/api/crews/join', { code: voice.code });
		await page.goto(`${BASE}${voice.path}`);
		await press(page, 'Join voice');
		await press(page, 'camera');
	}
	return contexts;
}

/** Opens the scene; returns how to read its world. */
async function open(page, scene, voice) {
	if (scene === 'world') {
		await page.goto(`${BASE}/dev/perf?case=world${LIGHT ? '&light=1' : ''}`);
		return 'perfWorld';
	}
	if (scene === 'ride') {
		await page.goto(`${BASE}/ride?road=intro&perf`);
		await press(page, 'Ride simulated');
		await press(page, 'Start the ride');
	} else {
		await page.goto(`${BASE}${voice.path}?perf`);
		await press(page, 'Join voice');
		await page.getByRole('button', { name: 'leave voice' }).waitFor();
		// The now bar's Ride: the channel's free ride, on the Pass loop.
		await press(page, 'Ride');
		if (scene === 'voice') await press(page, 'Ride simulated');
	}
	return 'wattroomPerf';
}

/**
 * CPU seconds so far of the browser's renderer processes (every page's,
 * BENCH_CAMS's too) and its GPU process: SwiftShader draws in the latter,
 * and voice's noise filter runs in the former, off the main thread.
 */
async function cpuTimes(sys) {
	const { processInfo } = await sys.send('SystemInfo.getProcessInfo');
	const sum = (type) =>
		processInfo
			.filter((p) => p.type === type)
			.reduce((a, p) => a + p.cpuTime, 0);
	return { renderer: sum('renderer'), gpu: sum('GPU') };
}

async function bench(browser, scene, rig) {
	const { context, page } = await rider(
		browser,
		'Bench',
		LIGHT ? 'light' : 'full',
	);
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: rig.rate });
	const voice = scene.startsWith('voice') ? await voiceChannel(page) : null;
	const cams = voice ? await joinCams(browser, CAMS, voice) : [];
	const handle = await open(page, scene, voice);
	const world =
		handle === 'perfWorld'
			? () => window.perfWorld
			: () => {
					const w = window.wattroomPerf?.world();
					return w && { ...w, probe: () => ({ renderer: w.renderer() }) };
				};
	await page.waitForFunction(
		(src) => (0, eval)(src)()?.stats().rendered > 0,
		`(${world})`,
		{ polling: 500, timeout: 300_000 },
	);
	const renderer = await page.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2');
		const ext = gl?.getExtension('WEBGL_debug_renderer_info');
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
	});
	await page.waitForTimeout(WARMUP * 1000);

	const read = () =>
		page.evaluate((src) => {
			const w = (0, eval)(src)();
			const p = w.probe();
			return {
				stats: w.stats(),
				frames: w.frames(),
				draws: p.renderer.draws,
				triangles: p.renderer.triangles,
				page: window.wattroomPerf?.summary() ?? null,
				videos: [...document.querySelectorAll('video')].filter(
					(v) => v.videoWidth > 0,
				).length,
			};
		}, `(${world})`);
	const first = await read(); // drops the warm-up's frames
	const sys = await browser.newBrowserCDPSession();
	const cpu0 = await cpuTimes(sys);
	const t0 = performance.now();
	const frames = [];
	const draws = [];
	const triangles = [];
	const pages = [];
	let videos = 0;
	let last = first;
	let profile = null;
	if (PROFILE) {
		await cdp.send('Profiler.enable');
		await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
	}
	for (let s = 0; s < SECONDS; s++) {
		if (PROFILE && s === 5) await cdp.send('Profiler.start');
		await page.waitForTimeout(1000);
		if (PROFILE && s === 15)
			profile = (await cdp.send('Profiler.stop')).profile;
		last = await read();
		frames.push(...last.frames);
		draws.push(last.draws);
		triangles.push(last.triangles);
		// The overlay's window is 5 s: one in five readings covers the run without overlap.
		if (last.page && s % 5 === 4) pages.push(last.page);
		videos = Math.max(videos, last.videos);
	}
	const cpu1 = await cpuTimes(sys);
	const wall = (performance.now() - t0) / 1000;
	await sys.detach();
	if (PROFILE && !profile) profile = (await cdp.send('Profiler.stop')).profile;
	// The largest canvas is the world's: an app page has the Skyline's and the lounge's too.
	const pixels = await page.evaluate(() =>
		Math.max(
			0,
			...[...document.querySelectorAll('canvas')].map(
				(c) => c.width * c.height,
			),
		),
	);
	await context.close();
	for (const c of cams) await c.close();

	const rendered = last.stats.rendered - first.stats.rendered;
	const missed = last.stats.missed - first.stats.missed;
	const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
	return {
		scene,
		rig,
		renderer,
		hz: last.stats.hz,
		pixels,
		fps: rendered / SECONDS,
		missedShare: missed / Math.max(1, rendered + missed),
		frame: [quantile(gaps, 0.5), quantile(gaps, 0.95)],
		js: [
			quantile(
				frames.map((f) => f.ms),
				0.5,
			),
			quantile(
				frames.map((f) => f.ms),
				0.95,
			),
		],
		draws: [quantile(draws, 0.5), Math.max(...draws)],
		triangles: [quantile(triangles, 0.5), Math.max(...triangles)],
		page: pages.length ? pageOf(pages) : null,
		videos,
		cpu: {
			renderer: (cpu1.renderer - cpu0.renderer) / wall,
			gpu: (cpu1.gpu - cpu0.gpu) / wall,
		},
		profile: profile && busiest(profile),
		errors,
	};
}

/** The overlay's five-second windows, as one run: medians of each. */
function pageOf(pages) {
	const med = (f) => quantile(pages.map(f).filter(Number.isFinite), 0.5);
	const spans = new Map();
	for (const p of pages)
		for (const s of p.spans) {
			if (!spans.has(s.name)) spans.set(s.name, []);
			spans.get(s.name).push(s);
		}
	return {
		fps: med((p) => p.fps),
		frame: [med((p) => p.frame.p50), med((p) => p.frame.p95)],
		longPerS: med((p) => p.longTasks.count / (p.windowMs / 1000)),
		longMsPerS: med((p) => p.longTasks.ms / (p.windowMs / 1000)),
		spans: [...spans]
			.map(([name, list]) => ({
				name,
				rate: quantile(
					list.map((s) => s.rate),
					0.5,
				),
				p95: quantile(
					list.map((s) => s.p95),
					0.5,
				),
				perSecond: quantile(
					list.map((s) => s.perSecond),
					0.5,
				),
			}))
			.sort((a, b) => b.perSecond - a.perSecond),
	};
}

/** A CPU profile's ten busiest functions by self time, as share of the profile. */
function busiest(profile) {
	const self = new Map();
	const byId = new Map(profile.nodes.map((n) => [n.id, n]));
	const dt = profile.timeDeltas ?? [];
	let total = 0;
	profile.samples.forEach((id, i) => {
		const n = byId.get(id);
		const f = n.callFrame;
		const file = f.url.split('/').pop()?.replace(/\?.*$/, '') ?? '';
		const key = `${f.functionName || '(anonymous)'}${file ? ` (${file}:${f.lineNumber + 1})` : ''}`;
		const us = dt[i] ?? 0;
		total += us;
		self.set(key, (self.get(key) ?? 0) + us);
	});
	return [...self]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([what, us]) => ({ what, share: us / total, msPerS: us / 1000 / 10 }));
}

const ms = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const k = (x) => `${Math.round(x / 1000)}k`;

const browser = await chromium.launch({
	// SwiftShader named, not fallen back to: a fallback composites in software
	// and reads every frame back on the page's main thread (#3877).
	args: [
		...(GL === 'gpu'
			? ['--enable-gpu', '--ignore-gpu-blocklist']
			: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
		'--mute-audio',
		// Voice: a fake microphone, and no prompt for it.
		'--use-fake-ui-for-media-stream',
		'--use-fake-device-for-media-stream',
	],
});
const results = [];
try {
	for (const scene of SCENES)
		for (const rig of RIGS) {
			console.error(
				`world-bench: ${scene}, ${rig.name}, ${WARMUP} s warm-up, ${SECONDS} s measured…`,
			);
			results.push(await bench(browser, scene, rig));
		}
} finally {
	await browser.close();
}

const r0 = results[0];
const PLACES = {
	world: '/dev/perf?case=world',
	ride: '/ride, Pass loop, simulated trainer',
	voice: `voice channel in voice${CAMS ? ` with ${CAMS} cameras` : ''}, Pass loop, simulated trainer`,
	'voice-standing': `voice channel in voice${CAMS ? ` with ${CAMS} cameras` : ''}, Pass loop, no trainer`,
};
console.log(
	`${LOOK === 'diorama' ? 'Diorama 3D' : 'Smooth'}${LIGHT ? ', Light' : ''} at ${VIEW.width}×${VIEW.height}${DPR === 1 ? '' : ` at ${DPR}×`} (${(r0.pixels / 1e6).toFixed(2)} MP drawn), ` +
		`${r0.hz.toFixed(0)} Hz, ${SECONDS} s after ${WARMUP} s; renderer: ${r0.renderer}\n`,
);
console.log(
	'| Scene | Rig | Frame interval p50 / p95 | Render JS p50 / p95 | Frames a second | Intervals missed | Draws p50 / max | Triangles p50 / max |',
);
console.log('|---|---|---|---|---|---|---|---|');
for (const r of results)
	console.log(
		`| ${PLACES[r.scene]} | ${r.rig.name} | ${ms(r.frame[0])} / ${ms(r.frame[1])} ms | ${ms(r.js[0])} / ${ms(r.js[1])} ms | ` +
			`${r.fps.toFixed(1)} | ${(r.missedShare * 100).toFixed(0)} % | ${r.draws[0]} / ${r.draws[1]} | ` +
			`${k(r.triangles[0])} / ${k(r.triangles[1])} |`,
	);
console.log('');
const app = results.filter((r) => r.page);
if (app.length) {
	console.log(
		'| Scene | Rig | Videos playing | Renderers / GPU process CPU | Page frames a second | Page frame p50 / p95 | Long tasks a second | Long-task ms a second | Busiest `wattroom:` spans, ms a second |',
	);
	console.log('|---|---|---|---|---|---|---|---|---|');
	for (const r of app)
		console.log(
			`| ${PLACES[r.scene]} | ${r.rig.name} | ${r.videos} | ${Math.round(r.cpu.renderer * 100)} % / ${Math.round(r.cpu.gpu * 100)} % | ${r.page.fps.toFixed(1)} | ${ms(r.page.frame[0])} / ${ms(r.page.frame[1])} ms | ` +
				`${r.page.longPerS.toFixed(1)} | ${Math.round(r.page.longMsPerS)} | ` +
				`${r.page.spans
					.filter(
						(s) => !s.name.startsWith('world-') || s.name === 'world-frame',
					)
					.slice(0, 4)
					.map((s) => `${s.name} ${ms(s.perSecond)}`)
					.join(', ')} |`,
		);
	console.log('');
}
for (const scene of SCENES) {
	const worst = results.filter((r) => r.scene === scene).at(-1);
	for (const [tier, [d, t]] of Object.entries(TIERS)) {
		const over = [
			worst.draws[1] > d && 'draws',
			worst.triangles[1] > t && 'triangles',
		].filter(Boolean);
		console.log(
			`${scene}, ${tier} tier (${d} draws, ${k(t)}): ${over.length ? `over in ${over.join(' and ')}` : 'inside'}`,
		);
	}
}
for (const r of results)
	console.log(
		`${r.scene}, ${r.rig.name}: ${r.missedShare > FALLBACK ? 'past' : 'inside'} the fallback (${FALLBACK * 100} % of intervals missed hands the ride to the Skyline)`,
	);
for (const r of results)
	if (r.profile) {
		console.log(
			`\n${r.scene}, ${r.rig.name}: busiest functions, self time over 10 s`,
		);
		for (const p of r.profile)
			console.log(
				`  ${(p.share * 100).toFixed(1).padStart(5)} %  ${ms(p.msPerS).padStart(6)} ms/s  ${p.what}`,
			);
	}
for (const r of results)
	if (r.errors.length)
		console.log(
			`\n${r.scene}, ${r.rig.name}, page errors:\n  ${r.errors.join('\n  ')}`,
		);
