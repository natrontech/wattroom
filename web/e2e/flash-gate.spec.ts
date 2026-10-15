import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';
import { H, W, verdict, type Frame } from './flash';

/**
 * An advisory flash gate (#3223, WCAG 2.3.1, ADR-0064, ADR-0072): a
 * SimulatedTrainer rides a short hill (count-in, the climb, the summit, the
 * run down to the end of the road) while 10 fps frames are judged for flashes.
 * Tagged @flash: the e2e workflow runs it in its own non-required job.
 * ponytail: the sprint result and the cheer burst are not on the stage of a
 * solo road ride yet; add them to the timeline when a surface draws them.
 */
const FRAME_MS = 100;

/** 500 m up 4 %, then 1.7 km down 6 %: the summit and the end within a couple of minutes. */
function hillGpx(): string {
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const top = 400 + (Date.now() % 1000) / 10;
	const points = Array.from({ length: 221 }, (_, i) => {
		const ele = i <= 50 ? top - 20 + 0.4 * i : top - 0.6 * (i - 50);
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>A made-up hill</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}

/** One screenshot of `page`, downscaled to the gate's grid on a scratch page. */
async function sample(page: Page, scratch: Page): Promise<Uint8Array> {
	const jpeg = await page.screenshot({ type: 'jpeg', quality: 60 });
	const rgb = await scratch.evaluate(
		async ([b64, w, h]) => {
			const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
			const bitmap = await createImageBitmap(blob);
			const canvas = new OffscreenCanvas(w as number, h as number);
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0, w as number, h as number);
			const { data } = ctx.getImageData(0, 0, w as number, h as number);
			const out: number[] = [];
			for (let i = 0; i < data.length; i += 4)
				out.push(data[i], data[i + 1], data[i + 2]);
			return out;
		},
		[jpeg.toString('base64'), W, H] as const,
	);
	return Uint8Array.from(rgb);
}

/** Frames of `page` every FRAME_MS until `done` says so (or `maxMs`). */
async function film(
	page: Page,
	scratch: Page,
	done: () => Promise<boolean>,
	maxMs: number,
): Promise<Frame[]> {
	const frames: Frame[] = [];
	const t0 = Date.now();
	while (Date.now() - t0 < maxMs && !(await done())) {
		const at = Date.now();
		frames.push({ t: at - t0, rgb: await sample(page, scratch) });
		await page.waitForTimeout(Math.max(0, FRAME_MS - (Date.now() - at)));
	}
	return frames;
}

test.describe('@flash the flash gate', () => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.use({ viewport: { width: 1024, height: 768 } });

	test('a scripted ride flashes at most once per 10 s, never 3 per second', async ({
		page,
		context,
	}) => {
		test.setTimeout(300_000);
		await page.addInitScript(() =>
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			),
		);
		const scratch = await context.newPage();
		await scratch.goto('about:blank');
		await signInAs(page, 'Flash Gate Rider', '/workouts/import');
		await page.locator('input[type=file]').setInputFiles({
			name: 'hill.gpx',
			mimeType: 'application/gpx+xml',
			buffer: Buffer.from(hillGpx()),
		});
		await page.getByRole('button', { name: 'Save to my routes' }).click();
		await expect(page.getByText(/is on your routes/)).toBeVisible();
		const { routes } = (await (
			await page.request.get('/api/routes')
		).json()) as {
			routes: { id: string }[];
		};
		await page.goto(`/ride?road=${routes[0].id}`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
		const start = page.getByRole('button', { name: 'Start the ride' });
		await start.click();

		const end = page.getByRole('region', { name: 'the end of the road' });
		const frames = await film(
			page,
			scratch,
			async () => (await end.count()) > 0,
			240_000,
		);
		expect(frames.length, 'the ride filmed nothing').toBeGreaterThan(100);
		const v = verdict(frames);
		console.log(
			`flash gate: ${frames.length} frames, flashes at ${v.times.join(', ')} ms`,
		);
		expect(v.per10s, 'more than 1 flash in 10 s').toBeLessThanOrEqual(1);
		expect(v.perSecond, '3 flashes in 1 s').toBeLessThan(3);
	});

	test('is red on an injected 4 Hz watt blink', async ({ page, context }) => {
		const scratch = await context.newPage();
		await scratch.goto('about:blank');
		await page.goto('about:blank');
		await page.evaluate(() => {
			const blink = document.createElement('div');
			blink.style.cssText =
				'position:fixed;inset:0;background:#ff00aa;animation:b 250ms steps(1) infinite';
			const style = document.createElement('style');
			style.textContent =
				'@keyframes b{0%{opacity:1}50%{opacity:0}}body{background:#0a051e}';
			document.head.append(style);
			document.body.append(blink);
		});
		const t0 = Date.now();
		const frames = await film(
			page,
			scratch,
			async () => Date.now() - t0 > 4000,
			5000,
		);
		const v = verdict(frames);
		console.log(`blink: ${frames.length} frames, ${v.times.length} flashes`);
		// A runner's screenshots fall short of 10 fps and so of 3 flashes in a
		// second; the budget is the thing a blink must break.
		expect(v.per10s, 'the blink went unseen').toBeGreaterThan(1);
	});
});
