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

	// On target is docs/SPEC.md's band, the one the riding screen scores with
	// (#2159). 128 W against a 120 W target is 8 W out: inside the ±10 W
	// floor, outside the ±5 % that floor exists to replace. The HUD used to
	// carry the percentage alone, so it called this off target while the
	// instrument it mirrors called it on.
	const target = page.getByTestId('hud-target');
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 128,
			target: 120,
			remaining: 60,
			label: 'Endurance',
		});
	});
	await expect(target).toContainText('120');
	await expect(target).toHaveClass(/text-ink/);
	// And genuinely outside it still reads as outside.
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 140,
			target: 120,
			remaining: 60,
			label: 'Endurance',
		});
	});
	// The watts assertion is what waits for the second snapshot to land, so
	// the class below is read after it rather than racing it.
	await expect(page.getByTestId('hud-watts')).toHaveText('140');
	await expect(target).not.toHaveClass(/text-ink/);

	// Two missed ticks and it goes quiet again rather than showing stale watts.
	await expect(page.getByTestId('hud-quiet')).toBeVisible({ timeout: 8000 });
});
