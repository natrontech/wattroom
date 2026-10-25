import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { judge, report, type Sample } from './soak/gate';
import { countHandles, type Handles } from './soak/handles';
import { signInAs } from './signin';

/**
 * The world soak (#3851): /dev/world ridden on its synthetic pass loop for
 * WORLD_SOAK_MINUTES simulated minutes (two hours by default) at
 * WORLD_SOAK_SPEED× (16), read once a simulated minute — the heap after a
 * collection, three.js's live geometries, textures and programs, the ground
 * held against the window its streamer means, the page's live listeners,
 * timers and frames, and each minute's frame times — then judged flat or not
 * by soak/gate.ts. Run by scripts/world-soak.mjs (`make world-soak`), which
 * serves a dev build: /dev/world and the world's hooks exist only there.
 * Skips unless WORLD_SOAK_OUT says where to write.
 */
const OUT = process.env.WORLD_SOAK_OUT;
const MINUTES = Number(process.env.WORLD_SOAK_MINUTES ?? 120);
const SPEED = Number(process.env.WORLD_SOAK_SPEED ?? 16);
/** Two 30 fps intervals: a frame that began later than this after the last one is a hitch. */
const HITCH_MS = 2000 / 30;
/** /dev/world's speeds. */
const SPEEDS = [1, 4, 16];

type Hooks = {
	__worldProbe?: () => {
		clock: number;
		d: number;
		ground: { pending: number; held: number; window: number };
		renderer: {
			draws: number;
			triangles: number;
			geometries: number;
			textures: number;
			programs: number;
		};
	};
	__worldFrames?: () => { at: number; ms: number }[];
	__handles?: () => Handles;
};

const quantile = (xs: number[], q: number) => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const read = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as Hooks;
		const probe = w.__worldProbe?.();
		return probe
			? { probe, frames: w.__worldFrames?.() ?? [], handles: w.__handles!() }
			: null;
	});

test('the world rides for hours and stays flat', async ({ page }) => {
	test.skip(!OUT, 'scripts/world-soak.mjs runs the soak (make world-soak)');
	expect(SPEEDS, `WORLD_SOAK_SPEED is one of ${SPEEDS}`).toContain(SPEED);
	// Software GL rides slower than the speed asks: allow the whole ride at 1×.
	test.setTimeout((MINUTES * 60 + 600) * 1000);

	await page.addInitScript(() => {
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
		// The world on, by either switch while the World control replaces the slot flag (#3214).
		localStorage.setItem('wattroom.world-slot.v1', '1');
		localStorage.setItem('wattroom.world.mode.v1', 'full');
		// Software GL misses every frame; the dev build's frame judge stands down (#3823).
		localStorage.setItem('wattroom.world-software.v1', '1');
	});
	await page.addInitScript(countHandles);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

	await signInAs(page, 'World Soak', '/dev/world');
	await page.waitForFunction(
		() => (window as unknown as Hooks).__worldProbe?.().ground.pending === 0,
		null,
		{ timeout: 120_000, polling: 500 },
	);
	await page.getByRole('button', { name: `${SPEED} times speed` }).click();

	const cdp = await page.context().newCDPSession(page);
	const heapMB = async () => {
		await cdp.send('HeapProfiler.collectGarbage');
		const { usedSize } = await cdp.send('Runtime.getHeapUsage');
		return usedSize / 2 ** 20;
	};

	const samples: Sample[] = [];
	const t0 = Date.now();
	let frames: { at: number; ms: number }[] = [];
	for (let minute = 0; minute <= MINUTES;) {
		const got = await read(page);
		expect(got, 'the world is drawing').not.toBeNull();
		await expect(page.getByText('The 3D view did not start.')).toHaveCount(0);
		const { probe, handles } = got!;
		frames.push(...got!.frames);
		if (probe.clock < minute * 60) {
			await page.waitForTimeout(500);
			continue;
		}
		const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
		const costs = frames.map((f) => f.ms);
		const s: Sample = {
			minute,
			wallS: (Date.now() - t0) / 1000,
			km: probe.d / 1000,
			heapMB: await heapMB(),
			geometries: probe.renderer.geometries,
			textures: probe.renderer.textures,
			programs: probe.renderer.programs,
			draws: probe.renderer.draws,
			triangles: probe.renderer.triangles,
			groundHeld: probe.ground.held,
			groundWindow: probe.ground.window,
			...handles,
			rendered: frames.length,
			frameP50: quantile(gaps, 0.5),
			frameP95: quantile(gaps, 0.95),
			costP50: quantile(costs, 0.5),
			costP95: quantile(costs, 0.95),
			hitches: gaps.filter((g) => g > HITCH_MS).length,
		};
		samples.push(s);
		console.log(
			`soak ${minute}/${MINUTES} min ${s.km.toFixed(1)} km heap ${s.heapMB.toFixed(1)} MB geo ${s.geometries} tex ${s.textures} ground ${s.groundHeld}/${s.groundWindow} listeners ${s.listeners} intervals ${s.intervals} frame p95 ${s.frameP95.toFixed(0)} ms`,
		);
		// The collection above stalled the page: those frames are the soak's, not the world's.
		await read(page);
		frames = [];
		minute++;
	}

	const software = await page.evaluate(() => {
		const gl = document.createElement('canvas').getContext('webgl2');
		const info = gl?.getExtension('WEBGL_debug_renderer_info');
		const name = info
			? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL))
			: '';
		return /swiftshader|llvmpipe|software/i.test(name);
	});
	const verdict = judge(samples, MINUTES, { software });
	await mkdir(OUT!, { recursive: true });
	await writeFile(
		join(OUT!, 'samples.json'),
		JSON.stringify(
			{ minutes: MINUTES, speed: SPEED, samples, verdict, errors },
			null,
			2,
		),
	);
	await writeFile(
		join(OUT!, 'report.md'),
		report(samples, MINUTES, SPEED, verdict),
	);
	expect(errors, 'the page threw').toEqual([]);
	expect(verdict.failures).toEqual([]);
});
