import { expect, test } from '@playwright/test';
import {
	CORRIDOR,
	JUKEBOX_SEAT,
	RIDER_BOX,
	meets,
	type Box,
} from '../src/lib/session/docks';
import { openAWorkoutOnARoad } from './route';
import { signInTo } from './signin';

/**
 * The world in slot 2, docked (#3031, ADR-0066, #3668): with the per-device
 * flag on, a ride draws the world behind its panels, and no panel — as the
 * page lays it out, not as docks.ts intends it — meets the keep-clear
 * corridor, the rider box or the jukebox seat, at the box table's sizes.
 * Every panel shows whole, never scrolled inside itself, and the 3 s power is
 * the one number in watt (G2). Measured the way desktop/smoke.spec.js
 * measures a window: the rectangles the browser actually drew.
 */
for (const [width, height] of [
	[1920, 1080],
	[1440, 900],
])
	test(`the docks leave the rider and the jukebox seat clear at ${width}×${height} @world`, async ({
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
		// A workout on a road, the ride that draws a world; long enough to outlast a slow build.
		await signInTo(page, '/ride');
		// Landed: the sign-in's bounce back to /ride would otherwise overtake the importer.
		await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
		await openAWorkoutOnARoad(page);
		await page.getByRole('button', { name: 'Ride simulated' }).click();
		await page.getByRole('button', { name: 'Start the ride' }).click();
		await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible({
			timeout: 30_000,
		});
		// Measured in the page, the moment the world draws behind its docks: a
		// runner without a GPU misses its frames, and ten seconds on the ride
		// rightly leaves for the flat road (#3080) — faster than a round trip
		// per dock comes back from a page that software GL keeps busy.
		// Building a world holds a loaded runner's main thread for a while.
		let drawn: { name: string; scrolls: boolean; box: Box }[];
		try {
			const measured = await page.waitForFunction(
				() => {
					const el = document.querySelector('[data-surface=docked]');
					const canvas = el?.querySelector('canvas');
					if (!el || !canvas || canvas.width === 300) return null;
					const s = el.getBoundingClientRect();
					const docks = [...el.querySelectorAll<HTMLElement>('[data-dock]')]
						.map((d) => ({
							name: d.dataset.dock!,
							r: d.getBoundingClientRect(),
							scrolls:
								d.scrollHeight > d.clientHeight + 1 ||
								d.scrollWidth > d.clientWidth + 1,
						}))
						.filter(({ r }) => r.width > 0 && r.height > 0)
						.map(({ name, r, scrolls }) => ({
							name,
							scrolls,
							box: {
								x0: (r.left - s.left) / s.width,
								y0: (r.top - s.top) / s.height,
								x1: (r.right - s.left) / s.width,
								y1: (r.bottom - s.top) / s.height,
							},
						}));
					const names = docks.map((d) => d.name);
					return ['header', 'numbers', 'horizon'].every((n) =>
						names.includes(n),
					)
						? docks
						: null;
				},
				null,
				{ polling: 100, timeout: 60_000 },
			);
			drawn = (await measured.jsonValue()) as typeof drawn;
		} finally {
			await info.attach('console', { body: said.join('\n') });
		}
		expect(
			drawn.map((d) => d.name),
			JSON.stringify(drawn),
		).toEqual(expect.arrayContaining(['header', 'numbers', 'horizon']));
		for (const { name, box, scrolls } of drawn) {
			expect(scrolls, `${name} cut short at ${width}×${height}`).toBe(false);
			expect(meets(box, CORRIDOR), `${name} in the corridor`).toBe(false);
			expect(meets(box, RIDER_BOX), `${name} over the rider`).toBe(false);
			expect(meets(box, JUKEBOX_SEAT), `${name} over the jukebox seat`).toBe(
				false,
			);
		}
		// One power figure, in watt (G2): the computer's head, nothing else.
		const inWatt = await page.evaluate(() => {
			const swatch = document.createElement('span');
			swatch.style.color = 'var(--color-watt)';
			document.querySelector('.cave, [data-surface=docked]')!.append(swatch);
			const watt = getComputedStyle(swatch).color;
			swatch.remove();
			return [...document.querySelectorAll('[data-surface=docked] *')]
				.filter(
					(e) =>
						getComputedStyle(e).color === watt &&
						[...e.childNodes].some(
							(n) => n.nodeType === Node.TEXT_NODE && /\d/.test(n.textContent!),
						),
				)
				.map((e) => e.textContent!.trim());
		});
		expect(inWatt, inWatt.join(', ')).toHaveLength(1);
	});

/**
 * A window too short for the box table rides flat and says why (Jan,
 * 2026-10-07, #3668): at 1280 × 720 slot 1 cannot end above the corridor at
 * SPEC's sizes.
 */
test('a window too short for the world rides the flat road and says so @world', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.addInitScript(() => {
		localStorage.setItem('wattroom.world-slot.v1', '1');
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
	});
	await signInTo(page, '/ride');
	await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
	await openAWorkoutOnARoad(page);
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(
		page.getByText('Flat road — this window is too short for the world'),
	).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('[data-surface=docked]')).toHaveCount(0);
});
