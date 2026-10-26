import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';

/**
 * The world's GPU object-ID checks (#3222): the synthetic pass loop drawn
 * with every object in its own colour, in Chromium's own WebGL, and three
 * things a rider would see counted off it. Advisory, like every e2e; the
 * analytic O6–O8 gates in placement/render.ts pin the same failures on the
 * CPU.
 */

let bundle = '';

test.beforeAll(async () => {
	const out = await build({
		configFile: false,
		logLevel: 'silent',
		// compose.ts reaches the icons through the roadside's words.
		plugins: [svelte({ configFile: false })],
		resolve: {
			alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) },
		},
		build: {
			write: false,
			minify: false,
			lib: {
				entry: fileURLToPath(new URL('./world-ids.entry.ts', import.meta.url)),
				formats: ['iife'],
				name: 'Ids',
			},
		},
	});
	const result = (Array.isArray(out) ? out[0] : out) as {
		output: { code: string }[];
	};
	bundle = result.output[0].code;
});

type Cover = { px: number; reach: number };
type Ids = {
	length(): number;
	mask(m: number): { px: number; by: Record<string, Cover> } | null;
	flicker(m: number, mm: number): number;
	ride(
		frames: number,
		minPx: number,
	): { name: string; px: number; frame: number }[];
};

/** Metres along the loop the jitter is measured at, spread over its length. */
const STANDS = [120, 1800, 4200, 7600];
/** Metres between two stands of the mask's sweep. */
const MASK_EVERY = 250;
/**
 * Where the road meets your tyres: the ground may cover the lowest 40 % of
 * your figure on screen, its wheels' band, and no higher. Your figure rides
 * pitched to 0.6 of the grade (crew.ts), so on a climb the road ahead meets
 * the front tyre a little above its contact.
 */
const WHEELS = 0.4;
const GROUND = /^(road|terrain)\b/;
/** The issue's numbers (#3222): a millimetre of jitter flips at most 8 px; nothing appears at over 20 px in a frame. */
const JITTER_MM = 1;
const FLICKER_PX = 8;
const POP_PX = 20;
/** Frames ridden for pops: 20 s at 30 fps, through the props' near ring and the ground's streaming. */
const RIDE_FRAMES = 600;

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
	errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	await page.setContent('<!doctype html><title>ids</title><body></body>');
	await page.addScriptTag({ content: bundle });
});

// A material whose ID shader does not compile draws nothing, and a check over nothing passes.
test.afterEach(() => expect(errors).toEqual([]));

test('nothing but the road under your wheels covers your figure @world', async ({
	page,
}) => {
	const length = await page.evaluate(() =>
		(window as unknown as { Ids: Ids }).Ids.length(),
	);
	const covered: string[] = [];
	for (let m = MASK_EVERY / 2; m < length; m += MASK_EVERY) {
		const got = await page.evaluate(
			(m) => (window as unknown as { Ids: Ids }).Ids.mask(m),
			m,
		);
		expect(got, `your figure at ${m} m`).not.toBeNull();
		expect(got!.px, `your figure on screen at ${m} m`).toBeGreaterThan(500);
		for (const [name, c] of Object.entries(got!.by))
			if (!GROUND.test(name) || c.reach > WHEELS)
				covered.push(
					`${name} over ${c.px} px of you, ${Math.round(c.reach * 100)} % up, at ${m} m`,
				);
	}
	expect(covered).toEqual([]);
});

test('a millimetre of camera jitter flips at most 8 pixels @world', async ({
	page,
}) => {
	for (const m of STANDS) {
		const n = await page.evaluate(
			([m, mm]) => (window as unknown as { Ids: Ids }).Ids.flicker(m, mm),
			[m, JITTER_MM],
		);
		expect(n, `pixels that flicker at ${m} m`).toBeLessThanOrEqual(FLICKER_PX);
	}
});

test('nothing appears from nothing at over 20 pixels in a frame @world', async ({
	page,
}) => {
	const pops = await page.evaluate(
		([frames, px]) => (window as unknown as { Ids: Ids }).Ids.ride(frames, px),
		[RIDE_FRAMES, POP_PX],
	);
	expect(pops).toEqual([]);
});
