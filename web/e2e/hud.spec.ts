import { expect, test } from '@playwright/test';
import { hudScale } from './design/probe';
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

/**
 * On a road (#3092): row 3 is the road — the grade under the rider and, on a
 * classed climb, how far to its top — the next 2 km draw as 20 bars in the
 * grade ramp, and the clock moves up beside the label so the shell's
 * 320×132 window still holds it all.
 */
test('the HUD draws the road a ride is on', async ({ context, page }) => {
	await page.setViewportSize({ width: 320, height: 132 });
	await signInAs(page, 'HUD Roadie', '/hud');
	await expect(page.getByTestId('hud-quiet')).toBeVisible();

	const rider = await context.newPage();
	await rider.goto('/home');
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 280,
			target: 0,
			remaining: 0,
			elapsed: 1800,
			label: 'Free ride',
			road: {
				grade: 8.94,
				km: 12.4,
				totalKm: 52.9,
				toTopM: 6000,
				climb: { cls: 'I', n: 3, of: 4 },
				ahead: Array.from({ length: 20 }, (_, i) => i * 0.7),
			},
		});
	});
	await expect(page.getByTestId('hud-road')).toHaveText('8.9 % · top 6.0 km');
	await expect(page.getByTestId('hud-remaining')).toHaveText('30:00 ridden');
	const strip = page.getByTestId('hud-ahead');
	await expect(strip.locator('rect')).toHaveCount(20);
	const box = await strip.boundingBox();
	expect(box && box.y + box.height).toBeLessThanOrEqual(132);
});

/**
 * A second screen (#3857, TARGETS hud item 2): the shell's rows scale as one
 * centred block, the watts' numerals about a quarter of the window's height,
 * and every word at SPEC's HUD column — the clock at 9vh, nothing under the
 * 2.9vh floor. The shell's 2.4 : 1 block used to bind on the width, which
 * left the numerals at 17 % and the rows spanning the window from its left.
 */
test('the HUD fills a second screen as one centred block', async ({
	context,
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await signInAs(page, 'HUD Second Screen', '/hud');
	await expect(page.getByTestId('hud-quiet')).toBeVisible();

	const rider = await context.newPage();
	await rider.goto('/home');
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 280,
			target: 0,
			remaining: 0,
			elapsed: 480,
			label: 'Free ride · Corridor switchbacks',
			road: {
				grade: 8.94,
				km: 12.4,
				totalKm: 52.9,
				toTopM: 6000,
				ahead: Array.from({ length: 20 }, (_, i) => i * 0.5),
			},
		});
	});
	await expect(page.getByTestId('hud-watts')).toHaveText('280');

	const { numeralVh, block, texts } = await page.evaluate(hudScale);
	expect(numeralVh).toBeGreaterThanOrEqual(21);
	expect(numeralVh).toBeLessThanOrEqual(27);
	// Centred, with the cave around it on every side.
	expect(block!.x0).toBeGreaterThan(5);
	expect(Math.abs(block!.x0 - (100 - block!.x1))).toBeLessThanOrEqual(0.5);
	expect(Math.abs(block!.y0 - (100 - block!.y1))).toBeLessThanOrEqual(0.5);
	expect(Math.min(...texts.map((t) => t.vh))).toBeGreaterThanOrEqual(2.9);
	expect(texts.find((t) => t.text === 'ridden')?.vh).toBeGreaterThanOrEqual(9);
	// The road's name wraps onto a second line rather than truncating away.
	const label = await page
		.getByTestId('hud-label')
		.evaluate((el) => [el.scrollHeight - el.clientHeight, el.clientHeight]);
	expect(label[0]).toBeLessThanOrEqual(1);
});
