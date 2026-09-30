import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';
import { climbGpx } from './road-gpx';

/**
 * The Skyline (#3059) on a road ridden alone: the road ahead with your dot,
 * moving under it. Invented road (route-ride.spec.ts): three kilometres
 * climbing 4 % in the open South Atlantic.
 */

async function rideTheRoad(page: Page, name: string) {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, name, '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await page.getByRole('button', { name: 'Ride it now' }).click();
	await page.waitForURL(/\/ride\?road=/);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start riding' }).click();
	const skyline = page.getByTestId('skyline');
	await expect(skyline.getByTestId('skyline-dot')).toBeVisible({
		timeout: 15_000,
	});
	return skyline;
}

/** How far the road has moved left under the dot, px. */
const shiftOf = (skyline: ReturnType<Page['getByTestId']>) =>
	skyline
		.locator(':scope > div')
		.first()
		.evaluate((el) => -new DOMMatrix(getComputedStyle(el).transform).m41);

test.describe('the Skyline', () => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	test('carries your dot, and the road moves under it by steps', async ({
		page,
	}) => {
		const skyline = await rideTheRoad(page, 'Skyline Rider');
		await expect(skyline.locator('svg path').first()).toBeAttached();
		const start = await shiftOf(skyline);
		await expect
			.poll(() => shiftOf(skyline), { timeout: 15_000 })
			.toBeGreaterThan(start);
		// Stepped from a timer: never a CSS transition, never an animation.
		const moving = await skyline.evaluate((el) => ({
			transitions: [...el.querySelectorAll('*')].filter(
				(n) => parseFloat(getComputedStyle(n).transitionDuration) > 0,
			).length,
			animations: el.getAnimations({ subtree: true }).length,
		}));
		expect(moving).toEqual({ transitions: 0, animations: 0 });
	});

	test('moves once a second, not ten times, for a rider who asked for stillness', async ({
		browser,
	}) => {
		const context = await browser.newContext({ reducedMotion: 'reduce' });
		const page = await context.newPage();
		const skyline = await rideTheRoad(page, 'Still Skyline Rider');
		const start = await shiftOf(skyline);
		await expect
			.poll(() => shiftOf(skyline), { timeout: 15_000 })
			.toBeGreaterThan(start);
		// Sampled in the page every 100 ms for 1.9 s: stepped once a second it
		// lands on at most three positions, stepped at 10 Hz on nearly every
		// sample. Hundredths of a pixel: at a climb's pace the road moves
		// about a pixel a second.
		const positions = await skyline
			.locator(':scope > div')
			.first()
			.evaluate(async (layer) => {
				const seen = new Set<number>();
				const until = performance.now() + 1900;
				while (performance.now() < until) {
					const m41 = new DOMMatrix(getComputedStyle(layer).transform).m41;
					seen.add(Math.round(m41 * 100));
					await new Promise((r) => setTimeout(r, 100));
				}
				return seen.size;
			});
		expect(positions).toBeLessThanOrEqual(3);
		await context.close();
	});
});

test.describe('the Skyline in forced colours', () => {
	test.use({ forcedColors: 'active' });
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	test('keeps the profile and your dot drawn', async ({ page }) => {
		const skyline = await rideTheRoad(page, 'Forced Skyline Rider');
		const drawn = await skyline.evaluate((el) => {
			const probe = document.createElement('div');
			probe.style.cssText =
				'background-color: Canvas; forced-color-adjust: none';
			document.body.append(probe);
			const canvas = getComputedStyle(probe).backgroundColor;
			probe.remove();
			const line = el.querySelector('path[fill="none"]')!;
			const dot = el.querySelector('[data-testid=skyline-dot]')!;
			// Painted: a colour with some alpha, and not the page's own.
			const painted = (colour: string) => {
				const [r, g, b, a = 1] = (colour.match(/[\d.]+/g) ?? []).map(Number);
				return a > 0 && `rgb(${r}, ${g}, ${b})` !== canvas;
			};
			return {
				line: painted(getComputedStyle(line).stroke),
				dot: painted(getComputedStyle(dot).backgroundColor),
			};
		});
		expect(drawn).toEqual({ line: true, dot: true });
	});
});
