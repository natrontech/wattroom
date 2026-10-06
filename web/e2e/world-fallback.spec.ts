import { expect, test, type Page } from '@playwright/test';
import { openAWorkoutOnARoad } from './route';
import { signInTo } from './signin';

/**
 * The world's fallback (#3080, ADR-0066): a world that stops mid-ride hands
 * the ride to the flat road, says why in slot 1 — a line, never a toast — and
 * stays there until the rider asks for 3D again. Forced both ways the world
 * can stop on a machine: its GPU context lost, its frames missed.
 */

/**
 * A solo workout on a road with the world on and 3D chosen, so a runner asking for reduced
 * motion still draws it, up to the moment the world first draws — and with
 * `lose`, its GPU context lost right then, in the page and in the same
 * breath: a runner without a GPU misses its frames and leaves for the flat
 * road on its own ten seconds later, sooner than a round trip comes back
 * from a page software GL keeps busy.
 */
async function rideInTheWorld(page: Page, lose = false) {
	await page.addInitScript(() => {
		localStorage.setItem('wattroom.world-slot.v1', '1');
		localStorage.setItem('wattroom.flat-road.v1', '0');
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
	});
	await signInTo(page, '/ride');
	// Landed: the sign-in's bounce back to /ride would otherwise overtake the importer.
	await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
	await openAWorkoutOnARoad(page);
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible({
		timeout: 30_000,
	});
	// Drawing: the renderer has sized its canvas off the 300 px default.
	// Building a world holds a loaded runner's main thread for a while.
	await page.waitForFunction(
		(lose) => {
			const canvas = document.querySelector<HTMLCanvasElement>(
				'[data-surface=docked] canvas',
			);
			if (!canvas || canvas.width === 300) return false;
			if (lose)
				canvas
					.getContext('webgl2')
					?.getExtension('WEBGL_lose_context')
					?.loseContext();
			return true;
		},
		lose,
		{ polling: 100, timeout: 60_000 },
	);
}

async function onTheFlatRoad(page: Page, why: RegExp) {
	await expect(page.getByTestId('flat-road')).toHaveText(why, {
		timeout: 30_000,
	});
	await expect(page.locator('[data-surface=docked]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible();
}

test('a lost GPU context hands the ride to the flat road, and 3D comes back on asking @world', async ({
	page,
}) => {
	await rideInTheWorld(page, true);
	await onTheFlatRoad(page, /graphics driver/);

	await page.getByRole('button', { name: 'Try 3D again' }).click();
	await expect(page.getByTestId('flat-road')).toHaveCount(0);
	await expect(page.locator('[data-surface=docked] canvas')).toBeVisible({
		timeout: 60_000,
	});
});

test('a world that misses its frames for ten seconds hands the ride to the flat road @world', async ({
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
