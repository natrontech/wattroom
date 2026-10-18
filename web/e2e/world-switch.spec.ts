import { expect, test } from '@playwright/test';
import { openAWorkoutOnARoad } from './route';
import { signInTo } from './signin';

// The world draws in a window the box table holds (TARGETS ride-road-world):
// Desktop Chrome's 1280 × 720 is shorter, and rides the flat road (#3668).
test.use({ viewport: { width: 1440, height: 900 } });

/**
 * 3D is the rider's to turn on (#3084, ADR-0066 amended): a road ride opens
 * on the flat road, "Ride in 3D" draws the world at once, the world's Flat
 * road button takes it away again, and each tap is the World control's.
 */
test('a road ride opens flat, and the rider switches to 3D and back @world', async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
		// A runner without a GPU draws in software; its frame judge stands down.
		localStorage.setItem('wattroom.world-software.v1', '1');
	});
	await signInTo(page, '/ride');
	await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
	await openAWorkoutOnARoad(page);
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByTestId('flat-road')).toHaveText(
		/Settings → Appearance/,
		{ timeout: 30_000 },
	);
	await expect(page.locator('[data-surface=docked]')).toHaveCount(0);
	const stored = () =>
		page.evaluate(() => localStorage.getItem('wattroom.world.mode.v1'));
	expect(await stored()).toBeNull();

	await page.getByRole('button', { name: 'Ride in 3D' }).click();
	await expect(page.getByTestId('flat-road')).toHaveCount(0);
	await expect(page.locator('[data-surface=docked] canvas')).toBeVisible({
		timeout: 60_000,
	});
	expect(await stored()).toBe('full');

	const flat = page.getByRole('button', { name: 'Flat road' });
	// A ride's control on a desk is 33 px, on the ride's scale (ADR-0087).
	expect((await flat.boundingBox())?.height).toBeGreaterThanOrEqual(32);
	await flat.click();
	await expect(page.getByTestId('flat-road')).toBeVisible();
	await expect(page.locator('[data-surface=docked]')).toHaveCount(0);
	expect(await stored()).toBe('flat');
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible();
});
