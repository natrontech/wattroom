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
			cadence: 88,
			heartRate: 142,
		});
	});
	await expect(page.getByTestId('hud-watts')).toHaveText('245');
	await expect(page.getByTestId('hud-cadence')).toHaveText('88 rpm');
	await expect(page.getByTestId('hud-heart')).toHaveText('142 bpm');
	// A feed older than the zones still draws, without the strip.
	await expect(page.getByTestId('hud-zones')).toHaveCount(0);
	await expect(page.getByTestId('hud-target')).toContainText('230');
	await expect(page.getByTestId('hud-remaining')).toHaveText('12:34 left');
	await expect(page.getByTestId('hud-label')).toHaveText('Sweet Spot');

	// The zone strip (#4099): seven segments, the current one lit, and the
	// time held beside it.
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 245,
			target: 230,
			remaining: 750,
			label: 'Sweet Spot',
			heartRate: 150,
			heartZone: 3,
			zone: 4,
			zoneSeconds: 83,
		});
	});
	const zones = page.getByTestId('hud-zones');
	await expect(page.getByTestId('hud-zone-time')).toHaveText('Z4 1:23');
	await expect(zones.locator('span[class*="bg-z"]')).toHaveCount(7);
	await expect(zones.locator('[data-lit]')).toHaveClass(/bg-z4/);
	await expect(page.getByTestId('hud-secondary')).toHaveText(
		/^\s*230\s*target\s*150\s*bpm\s*$/,
	);

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

/** Rows outside the block's padding, or the block outside the window. */
function clippedRows() {
	const el = document.querySelector('.hud')!;
	const hud = el.getBoundingClientRect();
	const pad = getComputedStyle(el);
	const top = hud.top + parseFloat(pad.paddingTop);
	const bottom =
		Math.min(hud.bottom, innerHeight) - parseFloat(pad.paddingBottom);
	const right = Math.min(hud.right, innerWidth) - parseFloat(pad.paddingRight);
	return [...el.querySelectorAll('*')]
		.map((child) => ({ child, r: child.getBoundingClientRect() }))
		.filter(
			({ r }) =>
				r.width > 0 &&
				(r.top < top - 0.5 || r.bottom > bottom + 0.5 || r.right > right + 0.5),
		)
		.map(({ child }) => child.getAttribute('data-testid') ?? child.tagName);
}

/**
 * On a road (#3092): the grade under the rider and, on a classed climb, how
 * far to its top, then the next 2 km as 20 bars in the grade ramp, and the
 * zone strip under them: the fullest the shell's 320×152 window gets.
 */
test('the HUD draws the road a ride is on', async ({ context, page }) => {
	await page.setViewportSize({ width: 320, height: 152 });
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
			cadence: 92,
			zone: 5,
			zoneSeconds: 754,
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
	// Heart rate only with a source. Exact text, not a count of nothing: a
	// count of 0 also passes once the HUD goes quiet.
	await expect(page.getByTestId('hud-secondary')).toHaveText(
		/^\s*92\s*rpm\s*$/,
	);
	await expect(page.getByTestId('hud-remaining')).toHaveText('30:00 ridden');
	await expect(page.getByTestId('hud-ahead').locator('rect')).toHaveCount(20);
	await expect(page.getByTestId('hud-zone-time')).toHaveText('Z5 12:34');
	// Nothing clipped: every row inside the block's padding, which is
	// inside the window.
	const clipped = await page.evaluate(clippedRows);
	expect(clipped).toEqual([]);

	// A lost trainer takes the strip's row, and still fits.
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 0,
			target: 0,
			remaining: 0,
			elapsed: 1801,
			label: 'Free ride',
			cadence: 0,
			zone: 0,
			fault: 'trainer',
			road: {
				grade: 8.94,
				km: 12.4,
				totalKm: 52.9,
				toTopM: 6000,
				ahead: Array.from({ length: 20 }, (_, i) => i * 0.7),
			},
		});
	});
	await expect(page.getByTestId('hud-fault')).toBeVisible();
	await expect(page.getByTestId('hud-zones')).toHaveCount(0);
	expect(await page.evaluate(clippedRows)).toEqual([]);
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
			label: 'Free ride · Corridor loop',
			cadence: 92,
			heartRate: 151,
			heartZone: 3,
			zone: 4,
			zoneSeconds: 83,
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
	expect(block!.y0).toBeGreaterThan(2);
	expect(Math.min(...texts.map((t) => t.vh))).toBeGreaterThanOrEqual(2.9);
	// SPEC's 9vh is the time's; its word is a unit, at most half (G4).
	expect(texts.find((t) => t.text === '8:00')?.vh).toBeGreaterThanOrEqual(9);
	expect(texts.find((t) => t.text === 'ridden')?.vh).toBeLessThanOrEqual(4.5);
	// The road's name wraps onto a second line rather than truncating away.
	const label = await page
		.getByTestId('hud-label')
		.evaluate((el) => [el.scrollHeight - el.clientHeight, el.clientHeight]);
	expect(label[0]).toBeLessThanOrEqual(1);
});
