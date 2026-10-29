import type { Page } from '@playwright/test';
import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * A WattRoom road rides any workout, and the workout changes mid-ride
 * (#4257): the road's card opens its How, as a route's does; on the ride,
 * Change workout starts another from its first block, and the ride, its
 * recording and the place on the loop carry on into one saved ride.
 */
const mute = () =>
	localStorage.setItem(
		'wattroom.mixer.v1',
		JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
	);

/** Slot 1's road line, "km 2.0 of 28.8 · 1.2 %", as metres along the road. */
async function metre(page: Page): Promise<number> {
	const line = await page.getByTestId('block-road').textContent();
	return Number(line?.match(/km ([\d.]+) of/)?.[1] ?? 0) * 1000;
}

/**
 * Slot 1's controls sit on its label row (TARGETS ride-road-world's box
 * table, v2-ride, #4283), and the road line starts under them. A name too
 * long for the row gives way at its own end, never under a control. A phone
 * puts the controls on a line of their own under the label.
 */
async function controlsOnTheLabelRow(page: Page, onRow = true) {
	for (const long of [false, true]) {
		const at = await page.getByTestId('ride-band').evaluate((band, long) => {
			const label = band.querySelector('[data-testid=ride-context]')!;
			const name = label.textContent;
			if (long)
				label.textContent = `Free ride · ${'A road with a very long name '.repeat(6)}`;
			const box = label.getBoundingClientRect();
			const buttons = [...band.querySelectorAll('button')].map((b) => ({
				word: b.textContent?.trim(),
				r: b.getBoundingClientRect(),
			}));
			const end = buttons.find((b) => b.word === 'End ride')!.r;
			const road = band
				.querySelector('[data-testid=block-road]')!
				.getBoundingClientRect();
			const seen = {
				endOnRow: end.top < box.bottom && end.bottom > box.top,
				roadUnder: road.top >= end.bottom,
				overlap: buttons.some(
					({ r }) =>
						r.left < box.right &&
						r.right > box.left &&
						r.top < box.bottom &&
						r.bottom > box.top,
				),
				cut: label.scrollWidth > label.clientWidth,
			};
			label.textContent = name;
			return seen;
		}, long);
		expect(at, long ? 'a long name' : 'the road name').toEqual({
			endOnRow: onRow,
			roadUnder: true,
			overlap: false,
			cut: long,
		});
	}
}

test.beforeEach(({ page }) => page.addInitScript(mute));

test("a free ride on the Pass loop draws its controls on slot 1's label row @world", async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await page.addInitScript(() =>
		localStorage.setItem('wattroom.world.mode.v1', 'full'),
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await signInAs(page, 'Road Label Rider', '/ride?road=intro');
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByTestId('block-road')).toContainText('of 28.8', {
		timeout: 15_000,
	});
	// Over the world slot 1 is as wide as its rows: a row that wraps there
	// put the controls under a short name.
	await expect(page.locator('[data-surface=docked]')).toBeVisible();
	await controlsOnTheLabelRow(page);
	// Too short for the world, so flat; then a phone.
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.locator('[data-surface=flat]')).toBeVisible();
	await controlsOnTheLabelRow(page);
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(page.locator('[data-surface=phone]')).toBeVisible();
	await controlsOnTheLabelRow(page, false);
});

test('the Pass loop card opens how to ride it, and picks a workout for it', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await signInAs(page, 'Road How Rider', '/workouts');
	await page
		.getByRole('list', { name: 'WattRoom roads' })
		.getByRole('link', { name: 'Pass loop' })
		.click();
	await expect(page).toHaveURL('/workouts/routes/intro');
	const how = page.getByRole('complementary', { name: 'how to ride it' });
	await expect(how.getByRole('link', { name: 'Ride it' })).toHaveAttribute(
		'href',
		'/ride?road=intro',
	);
	// The page body scrolls down, never sideways, at 375 px (ux.md).
	await page.setViewportSize({ width: 375, height: 812 });
	await expect
		.poll(() =>
			page
				.getByTestId('page-body')
				.evaluate((el) => el.scrollWidth - el.clientWidth),
		)
		.toBe(0);
	await page.setViewportSize({ width: 1440, height: 900 });
	await how.getByRole('button', { name: /Workout on it/ }).click();
	await how.getByRole('link', { name: 'Pick a workout' }).click();

	await expect(page).toHaveURL('/workouts?on=intro');
	await expect(
		page.getByRole('status').filter({ hasText: 'Pick a workout' }),
	).toContainText('Pick a workout for Pass loop');
	await page
		.getByRole('listitem')
		.filter({
			has: page.getByRole('link', { name: 'Recovery Spin', exact: true }),
		})
		.getByRole('button', { name: 'Ride', exact: true })
		.click();
	const picker = page.getByRole('dialog', { name: 'Ride it on a route' });
	await expect(picker).toContainText('Pass loop — where to start?');
	await expect(picker.getByRole('link', { name: 'From km 0' })).toHaveAttribute(
		'href',
		'/ride?w=recovery-spin&road=intro&from=0',
	);
});

test('a workout on the Pass loop, changed at km 2 and ended at km 4, saves one ride', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(600_000);
	await signInAs(page, 'Road Change Rider', '/workouts');
	// A strong, light rider: ERG's watts carry the dot the 2 km in minutes.
	const patched = await page.evaluate(() =>
		fetch('/api/me', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				displayName: 'Road Change Rider',
				ftpWatts: 400,
				weightKg: 60,
			}),
		}).then((res) => res.status),
	);
	expect(patched).toBe(200);
	// The ride reads the profile this browser pulled: wait for the new FTP.
	await page.reload();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(localStorage.getItem('wattroom.profile.v1') ?? '{}')
						.ftp as number | undefined,
			),
		)
		.toBe(400);

	await page.goto('/ride?w=sweet-spot-2x20&road=intro&from=1900');
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByTestId('block-road')).toContainText('of 28.8', {
		timeout: 15_000,
	});
	await expect
		.poll(() => metre(page), { timeout: 120_000, intervals: [1000] })
		.toBeGreaterThanOrEqual(2000);

	await page.getByRole('button', { name: 'Change workout' }).click();
	await page
		.getByRole('dialog', { name: 'Change workout' })
		.getByRole('button', { name: /^Tempo 45/ })
		.click();
	await expect(page.getByTestId('ride-context')).toContainText('Tempo 45');
	// From its first block, where the dot was.
	await expect(page.getByTestId('ride-clock')).toHaveText(/^0:[0-2]\d of /);
	expect(await metre(page)).toBeGreaterThanOrEqual(2000);

	await expect
		.poll(() => metre(page), { timeout: 420_000, intervals: [2000] })
		.toBeGreaterThanOrEqual(4000);
	await page.getByRole('button', { name: 'End ride' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'End the ride' })
		.click();
	const see = page.getByRole('link', { name: 'See your ride' });
	await expect(see).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/without its road/)).toHaveCount(0);

	const id = (await see.getAttribute('href'))!.split('/').at(-1);
	const ride = await page.evaluate(async (rideId) => {
		const res = await fetch(`/api/rides/${rideId}`);
		return (await res.json()) as {
			workoutName: string;
			samples: { m?: number }[];
		};
	}, id);
	expect(ride.workoutName).toBe('Sweet Spot 2×20 + Tempo 45');
	// One ride whose distance runs on through the change, never back to 0.
	const metres = ride.samples.map((s) => s.m ?? 0);
	expect(metres[0]).toBeLessThan(2000);
	// Slot 1 reads km 4.0 from 3,950 m on.
	expect(metres.at(-1)!).toBeGreaterThanOrEqual(3950);
	for (let i = 1; i < metres.length; i++)
		expect(metres[i]).toBeGreaterThanOrEqual(metres[i - 1]);
});

// #4277: with No workout the HUD and the TV still counted the time left
// against the six hours the open road may last.
test('with No workout on the Pass loop, the HUD and the TV read a free ride', async ({
	context,
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await signInAs(page, 'Road Free Rider', '/ride?w=recovery-spin&road=intro');
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await expect(page.getByTestId('block-road')).toContainText('of 28.8', {
		timeout: 15_000,
	});
	const hud = await context.newPage();
	await hud.goto('/hud');
	await expect(hud.getByTestId('hud-remaining')).toHaveText(/ left$/);

	await page.getByRole('button', { name: 'Change workout' }).click();
	await page
		.getByRole('dialog', { name: 'Change workout' })
		.getByRole('button', { name: /^No workout/ })
		.click();
	await expect(page.getByTestId('ride-context')).toContainText('Free ride');
	// Slot 1 is the free ride's (#4283): the road named, m climbed, Easier and Harder.
	await expect(page.getByTestId('ride-context')).toContainText('Free ride · ');
	await expect(page.getByTestId('ride-clock')).toContainText('m climbed');
	await expect(page.getByRole('button', { name: 'Harder' })).toBeVisible();
	await controlsOnTheLabelRow(page);
	// The ride's own minutes, never the 359 left of six hours.
	await page.getByRole('button', { name: 'TV mode' }).click();
	const tv = page.getByRole('dialog', { name: 'TV mode' });
	// A free ride's TV: no block, so the eyebrow names no Road block either.
	await expect(tv.getByRole('heading', { level: 1 })).toHaveText('Free ride');
	await expect(tv).not.toContainText(/\d{3}:\d\d/);
	await expect(hud.getByTestId('hud-remaining')).toHaveText(
		/^\d{1,2}:\d\d ridden$/,
	);
});
