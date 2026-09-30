// The interim design capture (#3664): screenshots and probes of the surfaces
// docs/design/TARGETS.md names, from a running dev pair. The design-shots
// spec replaces it (#3666), which deletes this file.
//
//   eval "$(scripts/dev-env.sh print)"; node web/scripts/design-capture.mjs \
//     --base "http://localhost:$WATTROOM_DEV_WEB_PORT" --scheme dark \
//     --out "$PWD/web/test-results/design/<slug>/before" [surface …]
//
// No surface named captures every one below. Each surface gets a fresh browser
// context signed in as the dev rider Designer, so no ride a surface leaves
// behind is recovered on the next. The mixer is zeroed — music, cues, board
// and share in one object — before any page mounts, and the browser is muted.
//
// Writes <id>.png and <id>.json (the probes: cave, overflowX, wattCount,
// panels, minTarget, world) into --out. A riding surface is asserted to be
// riding — its clock advances; whether it is the cave is a probe — and a world
// surface to have drawn the world rather than the Flat road. A surface that fails its
// assertion is written as FAILED-<id>.png and FAILED-<id>.txt instead, never
// as a picture of the page before the ride; the run then exits 1.
//
// The road is the capture's own hairpin climb, invented and in the open South
// Atlantic (#3054), imported on first use and found again by its name.
import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : fallback;
};
const port = process.env.WATTROOM_DEV_WEB_PORT;
const BASE = flag('--base', port && `http://localhost:${port}`);
const OUT = flag(
	'--out',
	fileURLToPath(new URL('../test-results/design/capture/', import.meta.url)),
);
const SCHEME = flag('--scheme', 'dark');
const only = args.filter(
	(a, i) =>
		!a.startsWith('--') &&
		!['--base', '--out', '--scheme'].includes(args[i - 1]),
);
if (!BASE || !['dark', 'light'].includes(SCHEME)) {
	console.error(
		'Usage: design-capture.mjs --base http://localhost:<vite> [--out <dir>] [--scheme dark|light] [surface …]',
	);
	process.exit(2);
}

const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = {
	viewport: { width: 375, height: 812 },
	hasTouch: true,
	isMobile: true,
};
const TV = { viewport: { width: 1920, height: 1080 } };
const HUD_SHELL = { width: 320, height: 132 };
const FULL_PAGE_CAP = 6000;
const RIDE_SECONDS = 14;
const FIXTURE = 'Design capture hairpins';

// The keep-clear corridor has one home, docks.ts; the probe reads it there.
const docks = readFileSync(
	new URL('../src/lib/session/docks.ts', import.meta.url),
	'utf8',
);
const CORRIDOR = JSON.parse(
	docks.match(/CORRIDOR: Box = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":'),
);

/** Ten 600 m legs joined by hairpins of 30 m radius, climbing 6.5 %. */
function hairpinsGpx() {
	const perLat = 111_195;
	const perLon = perLat * Math.cos((30 * Math.PI) / 180);
	const points = [];
	let x = 0;
	let y = 0;
	let along = 0;
	const at = (px, py) =>
		points.push(
			`<trkpt lat="${(-30 + py / perLat).toFixed(7)}" lon="${(-25 + px / perLon).toFixed(7)}"><ele>${(100 + 0.065 * along).toFixed(1)}</ele></trkpt>`,
		);
	at(x, y);
	for (let leg = 0; leg < 10; leg++) {
		const dir = leg % 2 ? -1 : 1;
		for (let i = 0; i < 60; i++) {
			x += dir * 10;
			along += 10;
			at(x, y);
		}
		if (leg === 9) break;
		for (let k = 1; k <= 9; k++) {
			const a = -Math.PI / 2 + (k * Math.PI) / 9;
			along += (30 * Math.PI) / 9;
			at(x + dir * 30 * Math.cos(a), y + 30 + 30 * Math.sin(a));
		}
		y += 60;
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom design capture" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Hairpins</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}

const browser = await chromium.launch({
	// Metal, or a Mac's headless Chromium falls back to software GL and the
	// world quietly draws the Flat road instead.
	args: [
		'--mute-audio',
		...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
	],
});

async function open(device, scheme = SCHEME) {
	const ctx = await browser.newContext({ ...device, colorScheme: scheme });
	await ctx.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	const page = await ctx.newPage();
	page.on('dialog', (d) => d.accept());
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
	await page.goto(`${BASE}/api/auth/dev/start?as=Designer`);
	return { ctx, page, errors };
}

async function setWorld(page, on) {
	await page.evaluate((v) => {
		if (v) localStorage.setItem('wattroom.world-slot.v1', '1');
		else localStorage.removeItem('wattroom.world-slot.v1');
	}, on);
}

let road = null;
/** The fixture road's id: found by its name, imported and named when absent. */
async function fixtureRoad(page) {
	if (road) return road;
	const list = async () =>
		(await page.evaluate(
			async () => (await (await fetch('/api/routes')).json()).routes,
		)) ?? [];
	const before = await list();
	road = before.find((r) => r.name === FIXTURE)?.id;
	if (road) return road;
	await page.goto(`${BASE}/workouts/import`);
	await page
		.locator('input[type=file]')
		.first()
		.setInputFiles({
			name: 'hairpins.gpx',
			mimeType: 'application/gpx+xml',
			buffer: Buffer.from(hairpinsGpx()),
		});
	await page.getByRole('button', { name: 'Save to my routes' }).click();
	await page.getByText(/is on your routes/).waitFor({ timeout: 15_000 });
	const known = new Set(before.map((r) => r.id));
	const id = (await list()).find((r) => !known.has(r.id))?.id;
	if (!id) throw new Error('the fixture road did not reach /api/routes');
	const renamed = await page.evaluate(
		async ([id, name]) =>
			(
				await fetch(`/api/routes/${id}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name }),
				})
			).ok,
		[id, FIXTURE],
	);
	if (!renamed) throw new Error('the fixture road could not be named');
	return (road = id);
}

/** Pairs the simulated trainer, starts, and rides until RIDE_SECONDS in. */
async function ride(page, url, seconds = RIDE_SECONDS) {
	await page.goto(BASE + url);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
	const start = page
		.getByRole('button', { name: /^Start (riding|the ride)$/ })
		.first();
	await start.waitFor({ timeout: 15_000 });
	await start.click();
	await page.waitForTimeout(seconds * 1000);
}

/**
 * A running ride: a clock on the page moves; a world, drawn. Whether the frame
 * is the cave is G1's question, so it is a probe rather than an assertion — a
 * ride that forgot the cave is the defect the shot exists to show.
 */
async function assertRiding(page, world) {
	const clocks = () =>
		page.evaluate(() =>
			(document.body.innerText.match(/\b\d{1,2}:\d{2}\b/g) ?? []).join(' '),
		);
	const first = await clocks();
	await page.waitForTimeout(2500);
	if (!first || first === (await clocks()))
		throw new Error(
			`the ride's clock did not advance (${first || 'no clock'})`,
		);
	if (world === undefined) return;
	const drawn = await page.evaluate(() => ({
		canvas: !!document.querySelector('canvas'),
		flat: document.body.innerText.match(/Flat road —[^\n]*/)?.[0] ?? null,
	}));
	if (world && (!drawn.canvas || drawn.flat))
		throw new Error(
			`the world did not draw: ${drawn.flat ?? 'no canvas mounted'}`,
		);
	if (!world && drawn.canvas)
		throw new Error('a world canvas mounted on a ride with no road');
}

/** Grows the viewport to the page body's height, so one shot holds the page. */
async function fullPage(page) {
	const height = await page.evaluate(() => {
		const body = document.querySelector('[data-testid=page-body]');
		return body
			? Math.ceil(body.getBoundingClientRect().top + body.scrollHeight)
			: 0;
	});
	const { width, height: now } = page.viewportSize();
	if (height > now) {
		await page.setViewportSize({
			width,
			height: Math.min(height, FULL_PAGE_CAP),
		});
		await page.waitForTimeout(500);
	}
}

/** Measurements, in the page: the only evidence a reviewer may cite. */
function probe(corridor) {
	const ctx = document
		.createElement('canvas')
		.getContext('2d', { willReadFrequently: true });
	const rgba = (color) => {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#0000';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return { r, g, b, a: a / 255 };
	};
	const lightness = ({ r, g, b }) => {
		const lin = (c) =>
			(c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		const [R, G, B] = [lin(r), lin(g), lin(b)];
		const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
		const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
		const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
		return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	};
	const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
	const shown = (el) => {
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return (
			r.width > 0 &&
			r.height > 0 &&
			cs.visibility !== 'hidden' &&
			r.bottom > 0 &&
			r.top < innerHeight
		);
	};
	const cave = document.querySelector('.cave');

	// G1: the lightest surface under a 6 × 5 grid of points, the world excepted.
	let maxL = 0;
	for (const fx of [0.02, 0.2, 0.4, 0.6, 0.8, 0.98])
		for (const fy of [0.02, 0.25, 0.5, 0.75, 0.98]) {
			let el = document.elementFromPoint(fx * innerWidth, fy * innerHeight);
			if (!el || el.closest('canvas')) continue;
			let bg = null;
			// A surface is a large box: a zone bar or a chip on it is not.
			for (; el; el = el.parentElement) {
				const r = el.getBoundingClientRect();
				if (r.width * r.height < 0.05 * innerWidth * innerHeight) continue;
				const c = rgba(getComputedStyle(el).backgroundColor);
				if (c.a > 0.5) {
					bg = c;
					break;
				}
			}
			maxL = Math.max(
				maxL,
				lightness(
					bg ??
						rgba(getComputedStyle(document.documentElement).backgroundColor),
				),
			);
		}

	// G2: text in watt. The token is read inside the cave, where it may differ.
	const swatch = document.createElement('span');
	swatch.style.color = 'var(--color-watt)';
	(cave ?? document.body).append(swatch);
	const watt = rgba(getComputedStyle(swatch).color);
	swatch.remove();
	const isWatt = (color) => {
		const c = rgba(color);
		return (
			c.a > 0.3 &&
			Math.abs(c.r - watt.r) + Math.abs(c.g - watt.g) + Math.abs(c.b - watt.b) <
				24
		);
	};
	const wattFigures = [];
	let wattMarks = 0;
	for (const el of document.body.querySelectorAll('*')) {
		if (!shown(el)) continue;
		const cs = getComputedStyle(el);
		const own = [...el.childNodes]
			.filter((n) => n.nodeType === 3)
			.map((n) => n.textContent)
			.join('')
			.trim();
		if (/\d/.test(own) && isWatt(el instanceof SVGElement ? cs.fill : cs.color))
			wattFigures.push(own.slice(0, 40));
		else if (
			el instanceof SVGGeometryElement &&
			(isWatt(cs.fill) || isWatt(cs.stroke))
		)
			wattMarks++;
	}

	// G3: the docks over the world, against the keep-clear corridor.
	const surface = document
		.querySelector('[data-surface=docked]')
		?.getBoundingClientRect();
	const panels = surface
		? [...document.querySelectorAll('[data-dock]')].filter(shown).map((el) => {
				const r = el.getBoundingClientRect();
				const box = {
					x0: round((r.left - surface.left) / surface.width),
					y0: round((r.top - surface.top) / surface.height),
					x1: round((r.right - surface.left) / surface.width),
					y1: round((r.bottom - surface.top) / surface.height),
				};
				return {
					dock: el.dataset.dock,
					box,
					alpha: round(rgba(getComputedStyle(el).backgroundColor).a, 2),
					overflow:
						el.scrollHeight > el.clientHeight + 1 ||
						el.scrollWidth > el.clientWidth + 1,
					corridor:
						box.x0 < corridor.x1 &&
						box.x1 > corridor.x0 &&
						box.y0 < corridor.y1 &&
						box.y1 > corridor.y0,
				};
			})
		: [];

	// G5: the page body's sideways overflow, and the smallest control. A control
	// inside a sentence is SC 2.5.8's inline exception, so it is not counted.
	const inSentence = (el) =>
		getComputedStyle(el).display === 'inline' ||
		[...el.parentElement.childNodes].some(
			(n) => n.nodeType === 3 && n.textContent.trim(),
		);
	const body = document.querySelector('[data-testid=page-body]');
	const controls = [
		...document.querySelectorAll(
			'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]',
		),
	].filter((el) => shown(el) && !inSentence(el));
	const sizes = controls.map((el) => {
		const r = el.getBoundingClientRect();
		const label =
			el.getAttribute('aria-label') ||
			el.innerText ||
			el.getAttribute('title') ||
			el.tagName;
		return {
			px: Math.round(Math.min(r.width, r.height)),
			label: label.trim().slice(0, 40),
		};
	});
	const smallest = sizes.reduce((a, b) => (b.px < a.px ? b : a), {
		px: Infinity,
		label: null,
	});

	return {
		cave: { present: !!cave, maxSurfaceL: round(maxL) },
		overflowX: body ? body.scrollWidth - body.clientWidth : null,
		wattCount: wattFigures.length,
		wattFigures,
		wattMarks,
		panels,
		minTarget: {
			px: Number.isFinite(smallest.px) ? smallest.px : null,
			label: smallest.label,
			under24: sizes.filter((s) => s.px < 24).length,
			under44: sizes.filter((s) => s.px < 44).length,
		},
		world: {
			canvas: !!document.querySelector('canvas'),
			flat: document.body.innerText.match(/Flat road —[^\n]*/)?.[0] ?? null,
		},
	};
}

async function shot(page, id, errors, full = false) {
	if (full) await fullPage(page);
	const probes = await page.evaluate(probe, CORRIDOR);
	await page.screenshot({ path: join(OUT, `${id}.png`) });
	await writeFile(
		join(OUT, `${id}.json`),
		JSON.stringify({ ...probes, pageErrors: errors }, null, 2) + '\n',
	);
	console.log('captured', id);
}

/** A desk or phone page, whole. */
const page_ = (id, device, path, { settle = 2500, full = true } = {}) => [
	id,
	async () => {
		const { page, errors } = await use(device);
		if (typeof path === 'function') await path(page);
		else await page.goto(BASE + path);
		await page.waitForTimeout(settle);
		await shot(page, id, errors, full);
	},
];

/** A ride, captured RIDE_SECONDS in. world: true = drawn, false = must not be, undefined = either. */
const ride_ = (id, device, url, { world, scheme } = {}) => [
	id,
	async () => {
		const { page, errors } = await use(device, scheme);
		await setWorld(page, !!world);
		await ride(page, typeof url === 'function' ? await url(page) : url);
		await assertRiding(page, world);
		await shot(page, id, errors);
	},
];

const roadRide = (query) => async (page) =>
	`/ride?${query}road=${await fixtureRoad(page)}`;

const SURFACES = Object.fromEntries([
	page_('home', DESK, '/home'),
	page_('phone-home', PHONE, '/home'),
	page_('workouts', DESK, async (page) => {
		await fixtureRoad(page);
		await page.goto(`${BASE}/workouts`);
	}),
	page_('phone-workouts', PHONE, async (page) => {
		await fixtureRoad(page);
		await page.goto(`${BASE}/workouts`);
	}),
	page_('route', DESK, async (page) =>
		page.goto(`${BASE}/workouts/routes/${await fixtureRoad(page)}`),
	),
	page_('phone-route', PHONE, async (page) =>
		page.goto(`${BASE}/workouts/routes/${await fixtureRoad(page)}`),
	),
	page_('import-idle', DESK, '/workouts/import'),
	page_('import', DESK, async (page) => {
		await page.goto(`${BASE}/workouts/import`);
		await page
			.locator('input[type=file]')
			.first()
			.setInputFiles({
				name: 'hairpins.gpx',
				mimeType: 'application/gpx+xml',
				buffer: Buffer.from(hairpinsGpx()),
			});
	}),
	page_('import-saved', DESK, async (page) => {
		await page.goto(`${BASE}/workouts/import`);
		await page
			.locator('input[type=file]')
			.first()
			.setInputFiles({
				name: 'hairpins.gpx',
				mimeType: 'application/gpx+xml',
				buffer: Buffer.from(hairpinsGpx()),
			});
		await page.getByRole('button', { name: 'Save to my routes' }).click();
		await page.getByText(/is on your routes/).waitFor({ timeout: 15_000 });
	}),
	page_('history', DESK, '/history'),
	page_('appearance', DESK, '/settings/appearance'),
	page_('ride-preride', DESK, '/ride', { full: false }),
	page_('dev-world', DESK, '/dev/world', { settle: 9000, full: false }),
	ride_('ride-free-road', DESK, roadRide(''), { scheme: 'light' }),
	ride_('ride-workout-flat', DESK, '/ride?w=openers'),
	ride_('ride-workout-world', DESK, '/ride?w=openers', { world: false }),
	ride_('ride-road-world', DESK, roadRide('w=openers&from=0&'), {
		world: true,
	}),
	ride_('ride-free-road-world', DESK, roadRide(''), { world: true }),
	ride_('phone-ride', PHONE, '/ride?w=openers'),
	ride_('phone-ride-road', PHONE, roadRide(''), { world: true }),
	[
		'ride-tv',
		async () => {
			const { page, errors } = await use(TV);
			await setWorld(page, true);
			await ride(page, '/ride?w=openers');
			await page
				.getByRole('button', { name: 'TV', exact: true })
				.first()
				.click();
			await page.waitForTimeout(3000);
			await assertRiding(page);
			await shot(page, 'ride-tv', errors);
		},
	],
	...['hud', 'hud-shell'].map((id) => [
		id,
		async () => {
			const { ctx, page } = await use(DESK);
			await setWorld(page, false);
			await ride(page, await roadRide('')(page), 8);
			await assertRiding(page);
			const hud = await ctx.newPage();
			const errors = [];
			hud.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
			if (id === 'hud-shell') await hud.setViewportSize(HUD_SHELL);
			await hud.goto(`${BASE}/hud`);
			await hud.waitForTimeout(4000);
			await shot(hud, id, errors);
		},
	]),
]);

let current = null;
async function use(device, scheme) {
	current = await open(device, scheme);
	return current;
}

const unknown = only.filter((id) => !SURFACES[id]);
if (unknown.length) {
	console.error(
		`Not captured by this script: ${unknown.join(', ')}. It knows: ${Object.keys(SURFACES).join(' ')}`,
	);
	process.exit(2);
}
await mkdir(OUT, { recursive: true });
const failed = [];
for (const [id, capture] of Object.entries(SURFACES)) {
	if (only.length && !only.includes(id)) continue;
	for (const stale of [
		`${id}.png`,
		`${id}.json`,
		`FAILED-${id}.png`,
		`FAILED-${id}.txt`,
	])
		await rm(join(OUT, stale), { force: true });
	try {
		await capture();
	} catch (e) {
		failed.push(id);
		const message = e instanceof Error ? e.message : String(e);
		console.error(`FAILED ${id}: ${message.split('\n')[0]}`);
		await writeFile(join(OUT, `FAILED-${id}.txt`), message + '\n');
		await current?.page
			.screenshot({ path: join(OUT, `FAILED-${id}.png`) })
			.catch(() => {});
	} finally {
		await current?.ctx.close();
		current = null;
	}
}
await browser.close();
console.log(
	`${OUT}: ${failed.length ? `FAILED ${failed.join(', ')}` : 'every surface captured'}`,
);
process.exit(failed.length ? 1 : 0);
