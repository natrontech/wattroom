import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The HUD (#296, ADR-0041): a second window that mirrors the riding screen
 * over a same-origin BroadcastChannel. Two pages in one context share the
 * channel exactly like two tabs — or the shell's two windows — do, so this
 * drives the feed from one page and reads the HUD in the other.
 */
test('the HUD waits, then shows what the riding screen publishes', async ({
	context,
	page,
}) => {
	await signInAs(page, 'HUD Rider', '/hud');
	// Numbers only: no sidebar, no page frame.
	await expect(page.getByTestId('hud-quiet')).toBeVisible();
	await expect(page.getByTestId('page-body')).toHaveCount(0);

	const rider = await context.newPage();
	await rider.goto('/home');
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 245,
			target: 230,
			remaining: 754,
			label: 'Sweet Spot',
		});
	});
	await expect(page.getByTestId('hud-watts')).toHaveText('245');
	await expect(page.getByTestId('hud-target')).toContainText('230');
	await expect(page.getByTestId('hud-remaining')).toHaveText('12:34 left');
	await expect(page.getByTestId('hud-label')).toHaveText('Sweet Spot');

	// Two missed ticks and it goes quiet again rather than showing stale watts.
	await expect(page.getByTestId('hud-quiet')).toBeVisible({ timeout: 8000 });
});
