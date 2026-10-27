import { expect, test } from '@playwright/test';
import { openAWorkoutOnARoad } from './route';
import { signInTo } from './signin';

// The world draws in a window the box table holds (TARGETS ride-road-world).
test.use({ viewport: { width: 1440, height: 900 } });

/**
 * The world's camera and the ride's picture answer a key and an ask alike
 * (#4253): 2 is the overhead camera, an ask with no camera named steps to
 * the next (the phone remote's Camera, a controller's camera button), and O
 * takes the ride's picture now, the one the closing card offers.
 */
test('the keys and the remote step the camera and take the picture @world', async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
		localStorage.setItem('wattroom.world-software.v1', '1');
		localStorage.setItem('wattroom.world.mode.v1', 'full');
	});
	await signInTo(page, '/ride');
	await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
	await openAWorkoutOnARoad(page);
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const canvas = page.locator('[data-surface=docked] canvas');
	await expect(canvas).toHaveAttribute('data-camera', 'chase', {
		timeout: 60_000,
	});

	await page.keyboard.press('2');
	await expect(canvas).toHaveAttribute('data-camera', 'heli');
	expect(
		await page.evaluate(
			() =>
				!window.dispatchEvent(
					new CustomEvent('wattroom:camera', { cancelable: true }),
				),
		),
	).toBe(true);
	await expect(canvas).toHaveAttribute('data-camera', 'side');

	await expect(canvas).not.toHaveAttribute('data-picture', 'taken');
	await page.keyboard.press('o');
	await expect(canvas).toHaveAttribute('data-picture', 'taken', {
		timeout: 15_000,
	});
});
