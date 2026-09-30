import { expect, test, type Page } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The world's fallback (#3080, ADR-0066): a world that stops mid-ride hands
 * the ride to the flat road, says why in slot 1 — a line, never a toast — and
 * stays there until the rider asks for 3D again. Forced both ways the world
 * can stop on a machine: its GPU context lost, its frames missed.
 */

/** A solo ride with the world on and 3D chosen, so a runner asking for reduced motion still draws it. */
async function rideInTheWorld(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('wattroom.world-slot.v1', '1');
		localStorage.setItem('wattroom.flat-road.v1', '0');
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
	});
	await signInTo(page, '/ride');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible({
		timeout: 30_000,
	});
	const canvas = page.locator('[data-surface=docked] canvas');
	// Drawing: the renderer has sized its canvas off the 300 px default.
	// Building a world holds a loaded runner's main thread for a while.
	await expect
		.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), {
			timeout: 60_000,
		})
		.not.toBe(300);
	return canvas;
}

async function onTheFlatRoad(page: Page, why: RegExp) {
	await expect(page.getByTestId('flat-road')).toHaveText(why, {
		timeout: 30_000,
	});
	await expect(page.locator('[data-surface=docked]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible();
}

test('a lost GPU context hands the ride to the flat road, and 3D comes back on asking', async ({
	page,
}) => {
	const canvas = await rideInTheWorld(page);
	await canvas.evaluate((c: HTMLCanvasElement) =>
		c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext(),
	);
	await onTheFlatRoad(page, /graphics driver/);

	await page.getByRole('button', { name: 'Try 3D again' }).click();
	await expect(page.getByTestId('flat-road')).toHaveCount(0);
	await expect(page.locator('[data-surface=docked] canvas')).toBeVisible({
		timeout: 60_000,
	});
});

test('a world that misses its frames for ten seconds hands the ride to the flat road', async ({
	page,
}) => {
	await rideInTheWorld(page);
	// The main thread held 120 ms at a time: every frame lands several
	// vsync-divisor intervals late, well past a fifth of them missed.
	await page.evaluate(() => {
		const until = performance.now() + 30_000;
		const hold = () => {
			const t = performance.now();
			while (performance.now() - t < 120);
			if (performance.now() < until) setTimeout(hold, 0);
		};
		hold();
	});
	await onTheFlatRoad(page, /dropped frames/);
});
