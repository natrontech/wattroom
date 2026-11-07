// The world's frame budget on software WebGL (#3082), run by `make world-bench`.
//
// WATTROOM.md: a gate that would need someone's hardware is met by a
// simulation. The slow rig is headless Chromium drawing WebGL on SwiftShader
// with the page's CPU throttled 4× (CDP), and stands for the low tier; the
// same run unthrottled is the reference beside it. Both ride /dev/perf's world
// case (the real scene on the synthetic pass loop, four riders) at the
// realism lab's 1280 × 720, and print frame time, missed vsync-divisor
// intervals, draws and triangles against docs/spec/world.md's tiers.
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
/** The 3D look (Settings → Look): `diorama`, the default, or `smooth`. */
const LOOK = process.env.BENCH_LOOK ?? 'diorama';
if (LOOK !== 'diorama' && LOOK !== 'smooth') {
	console.error(`BENCH_LOOK is diorama or smooth, not ${LOOK}.`);
	process.exit(1);
}
/** The World control's Light, the lowest rung (BENCH_LIGHT=1). */
const LIGHT = process.env.BENCH_LIGHT === '1';
const RIGS = [
	{ name: 'software', rate: 1 },
	{ name: 'software, CPU 4× slower', rate: 4 },
];
/** docs/spec/world.md, "The world": what each tier may draw. */
const TIERS = { high: [60, 400_000], low: [30, 150_000] };
/** The same file's Fallback, loop.ts's missWatch: the share of intervals missed over 10 s. */
const FALLBACK = 0.2;

/** The q-quantile of xs, nearest rank. */
const quantile = (xs, q) => {
	if (xs.length === 0) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

async function bench(browser, rig) {
	const context = await browser.newContext({
		viewport: VIEW,
		deviceScaleFactor: 1,
	});
	await context.addInitScript(
		(pixels) => {
			// AGENTS.md: mute before anything plays.
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			);
			// Software GL misses frames by design: the dev build's frame judge
			// stands down, so the world keeps drawing and its misses are counted here.
			localStorage.setItem('wattroom.world-software.v1', '1');
			localStorage.setItem('wattroom.world.pixels.v1', pixels);
		},
		LOOK === 'diorama' ? 'd' : '0',
	);
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: rig.rate });
	try {
		// The perf page lives in the app: signed out, it is sent to the sign-in page and its world goes.
		await page.goto(`${BASE}/api/auth/dev/start?as=Bench`);
		await page.goto(`${BASE}/dev/perf?case=world${LIGHT ? '&light=1' : ''}`);
	} catch (err) {
		throw new Error(
			`Nothing answers on ${BASE}: start \`make dev-web\` first.`,
			{
				cause: err,
			},
		);
	}
	await page.waitForFunction(
		() => window.perfWorld?.stats().rendered > 0,
		null,
		{
			polling: 500,
			timeout: 300_000,
		},
	);
	const renderer = await page.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2');
		const ext = gl?.getExtension('WEBGL_debug_renderer_info');
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
	});
	await page.waitForTimeout(WARMUP * 1000);

	const read = () =>
		page.evaluate(() => {
			const w = window.perfWorld;
			const p = w.probe();
			return {
				stats: w.stats(),
				frames: w.frames(),
				draws: p.renderer.draws,
				triangles: p.renderer.triangles,
				pending: p.ground.pending,
			};
		});
	const first = await read(); // drops the warm-up's frames
	const frames = [];
	const draws = [];
	const triangles = [];
	let last = first;
	for (let s = 0; s < SECONDS; s++) {
		await page.waitForTimeout(1000);
		last = await read();
		frames.push(...last.frames);
		draws.push(last.draws);
		triangles.push(last.triangles);
	}
	const pixels = await page.evaluate(() => {
		const c = document.querySelector('canvas');
		return c ? c.width * c.height : 0;
	});
	await context.close();

	const rendered = last.stats.rendered - first.stats.rendered;
	const missed = last.stats.missed - first.stats.missed;
	const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
	return {
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
		errors,
	};
}

const ms = (x) => x.toFixed(1);
const k = (x) => `${Math.round(x / 1000)}k`;

const browser = await chromium.launch({
	// SwiftShader named, not fallen back to: a fallback composites in software
	// and reads every frame back on the page's main thread (#3877).
	args: [
		'--use-angle=swiftshader',
		'--enable-unsafe-swiftshader',
		'--mute-audio',
	],
});
const results = [];
try {
	for (const rig of RIGS) {
		console.error(
			`world-bench: ${rig.name}, ${WARMUP} s warm-up, ${SECONDS} s measured…`,
		);
		results.push(await bench(browser, rig));
	}
} finally {
	await browser.close();
}

const r0 = results[0];
console.log(
	`/dev/perf?case=world in ${LOOK === 'diorama' ? 'Diorama 3D' : 'Smooth'}${LIGHT ? ', Light' : ''} at ${VIEW.width}×${VIEW.height} (${(r0.pixels / 1e6).toFixed(2)} MP), ` +
		`${r0.hz.toFixed(0)} Hz, ${SECONDS} s after ${WARMUP} s; renderer: ${r0.renderer}\n`,
);
console.log(
	'| Rig | Frame interval p50 / p95 | Render JS p50 / p95 | Frames a second | Intervals missed | Draws p50 / max | Triangles p50 / max |',
);
console.log('|---|---|---|---|---|---|---|');
for (const r of results)
	console.log(
		`| ${r.rig.name} | ${ms(r.frame[0])} / ${ms(r.frame[1])} ms | ${ms(r.js[0])} / ${ms(r.js[1])} ms | ` +
			`${r.fps.toFixed(1)} | ${(r.missedShare * 100).toFixed(0)} % | ${r.draws[0]} / ${r.draws[1]} | ` +
			`${k(r.triangles[0])} / ${k(r.triangles[1])} |`,
	);
console.log('');
const worst = results.at(-1);
for (const [tier, [d, t]] of Object.entries(TIERS)) {
	const over = [
		worst.draws[1] > d && 'draws',
		worst.triangles[1] > t && 'triangles',
	].filter(Boolean);
	console.log(
		`${tier} tier (${d} draws, ${k(t)}): ${over.length ? `over in ${over.join(' and ')}` : 'inside'}`,
	);
}
for (const r of results)
	console.log(
		`${r.rig.name}: ${r.missedShare > FALLBACK ? 'past' : 'inside'} the fallback (${FALLBACK * 100} % of intervals missed hands the ride to the Skyline)`,
	);
for (const r of results)
	if (r.errors.length)
		console.log(`\n${r.rig.name}, page errors:\n  ${r.errors.join('\n  ')}`);
