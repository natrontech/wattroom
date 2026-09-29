import { expect, test } from '@playwright/test';
import {
	JUKEBOX_SEAT,
	RIDER_BOX,
	meets,
	type Box,
} from '../src/lib/session/docks';
import { signInTo } from './signin';

/**
 * The world in slot 2, docked (#3031, ADR-0066): with the per-device flag on,
 * a ride draws the world behind its slots, and no slot — as the page lays it
 * out, not as docks.ts intends it — meets the rider box or the jukebox seat,
 * at a desk's two common sizes. Measured the way desktop/smoke.spec.js
 * measures a window: the rectangles the browser actually drew.
 */
for (const [width, height] of [
	[1920, 1080],
	[1280, 720],
])
	test(`the docks leave the rider and the jukebox seat clear at ${width}×${height}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width, height });
		// A world that falls back says why in the console; a red run carries it.
		const said: string[] = [];
		page.on('console', (m) => said.push(`${m.type()}: ${m.text()}`));
		page.on('pageerror', (e) => said.push(`pageerror: ${e.message}`));
		await page.addInitScript(() => {
			localStorage.setItem('wattroom.world-slot.v1', '1');
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			);
		});
		// The default workout: an hour long, so the ride outlasts a slow build.
		await signInTo(page, '/ride');
		await page.getByRole('button', { name: 'Ride simulated' }).click();
		await page.getByRole('button', { name: 'Start the ride' }).click();
		await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible({
			timeout: 30_000,
		});
		const surface = page.locator('[data-surface=docked]');
		await expect(surface).toBeVisible();
		// The world started: its canvas fills the surface behind the docks.
		// Building a world holds a loaded runner's main thread for a while.
		try {
			await expect(surface.locator('canvas')).toBeVisible({ timeout: 60_000 });
		} finally {
			await info.attach('console', { body: said.join('\n') });
		}

		for (const dock of ['header', 'numbers', 'horizon'])
			await expect(surface.locator(`[data-dock=${dock}]`)).toBeVisible();
		const drawn = await surface.evaluate((el) => {
			const s = el.getBoundingClientRect();
			return [...el.querySelectorAll<HTMLElement>('[data-dock]')]
				.map((d) => ({ name: d.dataset.dock!, r: d.getBoundingClientRect() }))
				.filter(({ r }) => r.width > 0 && r.height > 0)
				.map(({ name, r }) => ({
					name,
					box: {
						x0: (r.left - s.left) / s.width,
						y0: (r.top - s.top) / s.height,
						x1: (r.right - s.left) / s.width,
						y1: (r.bottom - s.top) / s.height,
					},
				}));
		});
		expect(
			drawn.map((d) => d.name),
			JSON.stringify(drawn),
		).toEqual(expect.arrayContaining(['header', 'numbers', 'horizon']));
		for (const { name, box } of drawn as { name: string; box: Box }[]) {
			expect(meets(box, RIDER_BOX), `${name} over the rider`).toBe(false);
			expect(meets(box, JUKEBOX_SEAT), `${name} over the jukebox seat`).toBe(
				false,
			);
		}
	});
