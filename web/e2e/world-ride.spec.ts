import { expect, test, type Page } from '@playwright/test';
import { climbGpx } from './road-gpx';
import { importARoute, openAWorkoutOnARoad } from './route';
import { signInAs } from './signin';
import { drawing, onTheRoad, worldOn } from './world';

/**
 * The 3D ride end to end (#3850), on the software GL the world project draws
 * with: a free ride on the rider's own road and a workout on one, each from
 * the first click to the saved ride, the free ride at TV and phone sizes, a
 * hidden tab and a trainer that falls silent. A lost context and missed frames
 * are world-fallback.spec.ts's.
 * Software GL misses its frames, so the built app's frame judge hands each
 * ride to the Skyline seconds in (#3877): the world is checked while it
 * draws, and the rest of the ride may go on over the Skyline, for that reason
 * and no other.
 */

// The world draws in a window the box table holds (TARGETS ride-road-world).
test.use({ viewport: { width: 1440, height: 900 } });

test.skip(
	!!process.env.PLAYWRIGHT_BASE_URL,
	'the ?as= dev provider only exists on a dev server',
);

/** The saver keeps a ride from a minute (docs/SPEC.md's minute rule). */
const A_MINUTE_MS = 65_000;

/** Imports the invented climb, rides it alone on the simulated trainer, and answers its route id. */
async function rideMyRoad(page: Page, as: string): Promise<string> {
	await worldOn(page);
	await signInAs(page, as, '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await page.getByRole('button', { name: 'Ride it now' }).click();
	await page.waitForURL(/\/ride\?road=/);
	const road = new URL(page.url()).searchParams.get('road')!;
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	return road;
}

/** The rider's newest ride, as their list has it. */
async function latestRide(page: Page) {
	return page.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: {
				distanceM?: number;
				climbedM?: number;
				road?: { routeId: string };
			}[];
		};
		return rides[0];
	});
}

/** Where slot 1's road line and the Skyline put the rider, in metres, read in one breath. */
const placed = (page: Page) =>
	page.evaluate(() => {
		const line = document.querySelector('[data-testid=block-road]');
		const km = Number(line?.textContent?.match(/km ([\d.]+) of/)?.[1]);
		const along = Number(
			document.querySelector<HTMLElement>('[data-testid=skyline]')?.dataset
				.along,
		);
		return { line: km * 1000, skyline: along };
	});

/** The metre the world drew you at, while it draws. */
const drawnAt = (page: Page) =>
	page.evaluate(() => {
		const said = document.querySelector<HTMLCanvasElement>(
			'canvas[data-riders]',
		)?.dataset.riders;
		return said
			? (JSON.parse(said) as { riders: { d: number }[] }).riders[0]?.d
			: null;
	});

test('a free ride on your road draws the world, shifts, and saves against the road @world', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const road = await rideMyRoad(page, 'World Road Rider');
	await drawing(page);

	// The world moves you along the road it drew.
	const first = await drawnAt(page);
	expect(first, 'the world drew nobody').not.toBeNull();
	await expect
		.poll(() => drawnAt(page), { message: 'the world never moved you' })
		.toBeGreaterThan(first!);

	// Slot 1's line and the Skyline agree on where you are: the line in
	// tenths of a kilometre, the Skyline in metres.
	await expect
		.poll(async () => {
			const { line, skyline } = await placed(page);
			return Math.abs(line - skyline);
		})
		.toBeLessThanOrEqual(100);

	// Harder and Easier move the gear on the computer's RIDE page: the road
	// is a class IV climb from its first metre, so it opens on CLIMB (#3645).
	await page
		.getByTestId('bike-computer')
		.getByRole('button', { name: /(previous|next) page, RIDE/ })
		.click();
	const gear = page
		.getByTestId('bike-computer')
		.locator('[data-field=gear]')
		.locator('span')
		.nth(1);
	const before = await gear.textContent();
	await page.getByRole('button', { name: 'Harder', exact: true }).click();
	await expect(gear).not.toHaveText(before!);
	await page.getByRole('button', { name: 'Easier', exact: true }).click();
	await expect(gear).toHaveText(before!);

	await page.waitForTimeout(A_MINUTE_MS);
	await onTheRoad(page);
	const { line, skyline } = await placed(page);
	expect(line, 'a minute in, still at km 0').toBeGreaterThan(0);
	expect(Math.abs(line - skyline)).toBeLessThanOrEqual(100);

	await page.getByRole('button', { name: 'End ride' }).click();
	await expect(page.getByText('See your ride')).toBeVisible({
		timeout: 20_000,
	});
	const saved = await latestRide(page);
	expect(saved.road?.routeId, 'the ride saved off the road').toBe(road);
	expect(saved.distanceM, 'the replay kept no distance').toBeGreaterThan(0);
	expect(saved.climbedM, 'the replay kept no climbing').toBeGreaterThan(0);
});

test('a workout on your road heads its block and km, holds ERG, and saves against the road @world', async ({
	page,
}) => {
	test.setTimeout(240_000);
	await worldOn(page);
	await signInAs(page, 'World Workout Rider', '/ride');
	// Openers, ended by hand: the one-minute fixture loses its first seconds
	// to the world's build on software GL, and falls under the minute rule.
	const road = await openAWorkoutOnARoad(page);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	await drawing(page);

	// The header over the world: the block, and the km along the road.
	const header = page.locator('[data-dock=header]');
	await expect(header.getByTestId('block-road')).toHaveText(
		/^km \d\.\d of 3\.0 · /,
	);
	await expect(header.getByTestId('trainer-chip')).toHaveText(/^ERG/);

	await page.waitForTimeout(A_MINUTE_MS + 15_000);
	await onTheRoad(page);
	await page.getByRole('button', { name: 'End ride' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'End the ride' })
		.click();
	await expect(page.getByRole('link', { name: 'See your ride' })).toBeVisible({
		timeout: 20_000,
	});
	const saved = await latestRide(page);
	expect(saved.road?.routeId, 'the ride saved off the road').toBe(road);
	expect(saved.climbedM, 'the replay kept no climbing').toBeGreaterThan(0);
});

/**
 * The same free ride on a TV and on a phone (ux.md): every panel drawn is on
 * the screen, and the page scrolls down, never sideways.
 */
for (const [width, height] of [
	[1920, 1080],
	[375, 812],
])
	test(`a free ride on your road keeps every panel on a ${width}×${height} screen @world`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height });
		await rideMyRoad(page, 'World Size Rider');
		await drawing(page);
		const off = await page.evaluate(
			({ width }) =>
				[
					...document.querySelectorAll<HTMLElement>(
						'[data-dock], [data-testid=bike-computer], [data-testid=skyline], [data-testid=ride-band]',
					),
				]
					.map((el) => ({
						name: el.dataset.dock ?? el.dataset.testid,
						r: el.getBoundingClientRect(),
					}))
					.filter(({ r }) => r.width > 0 && r.height > 0)
					.filter(({ r }) => r.left < -1 || r.right > width + 1)
					.map(({ name, r }) => `${name} ${r.left}–${r.right}`),
			{ width },
		);
		expect(off, 'panels off the screen').toEqual([]);
		await expect
			.poll(() =>
				page
					.getByTestId('page-body')
					.evaluate((el) => el.scrollWidth - el.clientWidth),
			)
			.toBe(0);
		await onTheRoad(page);
	});

/** The free ride's clock, in seconds. */
const clock = async (page: Page) => {
	const [m, s] = (await page.getByTestId('ride-clock').textContent())!
		.split(' ')[0]
		.split(':')
		.map(Number);
	return m * 60 + s;
};

/** When the world last drew, by its own stamp, or null once it has handed the ride on. */
const drewAt = (page: Page) =>
	page.evaluate(() => {
		const said = document.querySelector<HTMLCanvasElement>(
			'canvas[data-riders]',
		)?.dataset.riders;
		return said ? (JSON.parse(said) as { t: number }).t : null;
	});

/** Tells the page its tab is hidden or shown, the way a browser does (loop.ts's hidden gate). */
const tabHidden = (page: Page, hidden: boolean) =>
	page.evaluate((hidden) => {
		Object.defineProperty(document, 'hidden', {
			configurable: true,
			get: () => hidden,
		});
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => (hidden ? 'hidden' : 'visible'),
		});
		document.dispatchEvent(new Event('visibilitychange'));
	}, hidden);

test('a hidden tab stops the world drawing, and the ride keeps its time @world', async ({
	page,
}) => {
	test.setTimeout(180_000);
	await rideMyRoad(page, 'World Hidden Rider');
	await drawing(page);
	// Hidden at once: a hidden second is no evidence for the frame judge, so
	// software GL cannot hand the ride on while the tab is away.
	await tabHidden(page, true);
	const from = await clock(page);
	await page.waitForTimeout(1_000);
	const stopped = await drewAt(page);
	expect(stopped, 'the world was gone before the tab was').not.toBeNull();
	await page.waitForTimeout(8_000);
	expect(await drewAt(page), 'the world drew in a hidden tab').toBe(stopped);
	expect(
		await clock(page),
		'the ride lost time while hidden',
	).toBeGreaterThanOrEqual(from + 8);

	await tabHidden(page, false);
	await expect
		.poll(() => drewAt(page), { message: 'the world never woke' })
		.toBeGreaterThan(stopped!);
	await onTheRoad(page);
});

/** Twenty seconds at 200 W, then nothing: the replay trainer falls silent (simulated.ts, #54). */
const SILENCE = {
	samples: Array.from({ length: 20 }, () => ({ watts: 200, cadence: 88 })),
};

test('a trainer that falls silent on your road holds the ride and offers one button @world', async ({
	page,
}) => {
	await worldOn(page);
	await signInAs(page, 'World Silent Rider', '/ride');
	await page.route('**/fixtures/world-silence.json', (route) =>
		route.fulfill({ json: SILENCE }),
	);
	const road = await importARoute(page);
	await page.goto(`/ride?road=${road}&replay=world-silence`);
	// The replay starts the ride itself.
	await page.getByTestId('ride-replay').click({ timeout: 15_000 });
	await drawing(page);

	const status = page
		.getByRole('alert')
		.filter({ hasText: 'Trainer sends nothing' });
	await expect(status).toBeVisible({ timeout: 40_000 });
	await expect(
		status.getByRole('button', { name: 'Pair again' }),
	).toBeVisible();
	await onTheRoad(page);
});
