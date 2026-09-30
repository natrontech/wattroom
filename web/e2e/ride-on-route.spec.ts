import type { Page } from '@playwright/test';
import { expect, test } from './crew';
import { importARoute } from './route';
import { signInAs } from './signin';

/**
 * Any workout, on one of your own roads (#3594), on the SimulatedTrainer: the
 * card's "On a route" picks the road and the start; the ride keeps its blocks
 * on the clock, the dot moves at the rider's watts, and the ride saves on the
 * route with the execution the same ride scores off it. The two rides go side
 * by side, so the comparison costs one minute, not two — by two riders, since
 * nobody rides two at once and the server keeps only the first. Behind the
 * roads dev gate, which a dev server opens.
 */
const RIDER = 'Workout Road Rider';
const FLAT = 'Workout Flat Rider';

const mute = () =>
	localStorage.setItem(
		'wattroom.mixer.v1',
		JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
	);

async function rideSmoke(page: Page, query: string): Promise<void> {
	await page.goto(`/ride?w=smoke-test${query}`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
}

/** Newest first; a dev rider keeps the rides of earlier runs. */
async function latestRide(page: Page) {
	return page.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: {
				execution: number;
				executionScored: boolean;
				climbedM?: number;
			}[];
		};
		return rides[0];
	});
}

test('any workout rides on your own route by the clock, and saves on it', async ({
	page,
	browser,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	await page.addInitScript(mute);
	await signInAs(page, RIDER, '/workouts');
	const routeId = await importARoute(page);

	// The card's door: the road, then where on it.
	await page.goto('/workouts');
	await page
		.getByRole('listitem')
		.filter({
			has: page.getByRole('link', { name: 'Recovery Spin', exact: true }),
		})
		.getByRole('button', { name: 'On a route' })
		.click();
	const picker = page.getByRole('dialog', { name: 'Ride it on a route' });
	await picker
		.getByRole('list', { name: 'your routes' })
		.getByRole('listitem')
		.first()
		.getByRole('button', { name: 'Pick' })
		.click();
	await expect(picker.getByRole('link', { name: 'From km 0' })).toHaveAttribute(
		'href',
		`/ride?w=recovery-spin&road=${routeId}&from=0`,
	);

	// Recovery Spin is forty minutes; the one-minute fixture rides the seam.
	const flat = await browser.newContext();
	const off = await flat.newPage();
	await off.addInitScript(mute);
	await signInAs(off, FLAT, '/workouts');
	await Promise.all([
		rideSmoke(page, `&road=${routeId}&from=0`),
		rideSmoke(off, ''),
	]);
	await expect(page.getByText(/^0\.0 of 3\.0 km$/)).toBeVisible({
		timeout: 15_000,
	});
	// Blocks end by the clock on a road that pins nothing: Skip is there.
	await expect(page.getByRole('button', { name: 'Skip block' })).toBeVisible();
	// The road runs by the clock here, so the trainer holds ERG and the
	// header says the road is scenery (#3485, ADR-0062).
	await expect(page.getByTestId('trainer-chip')).toHaveText(
		'ERG: the road is scenery',
	);
	// On a road the horizon is the road ahead (#3641): the Skyline, your dot.
	await expect(
		page.getByTestId('skyline').getByTestId('skyline-dot'),
	).toBeVisible();
	await expect
		.poll(
			async () =>
				Number(
					(await page.getByText(/ of 3\.0 km$/).textContent())?.split(' ')[0],
				),
			{ message: 'the dot never left km 0', timeout: 30_000 },
		)
		.toBeGreaterThan(0);
	// Slot 1 says where on the road, as the HUD is told (#3639).
	await expect(page.getByTestId('block-road')).toHaveText(
		/^km \d\.\d of 3\.0 · -?\d+\.\d %/,
	);

	await page.setViewportSize({ width: 375, height: 812 });
	await expect
		.poll(() =>
			page
				.getByTestId('page-body')
				.evaluate((el) => el.scrollWidth - el.clientWidth),
		)
		.toBe(0);

	for (const tab of [page, off])
		await expect(tab.getByRole('link', { name: 'See your ride' })).toBeVisible({
			timeout: 150_000,
		});

	const onRoad = await latestRide(page);
	const offRoad = await latestRide(off);
	expect(onRoad.climbedM, 'the ride did not save on the route').toBeGreaterThan(
		0,
	);
	expect(offRoad.climbedM, 'the ride off the route climbed').toBeFalsy();
	expect(onRoad.executionScored).toBe(true);
	// ponytail: the simulator's noise differs between two rides, so equal
	// watts scoring equally is the unit tests' (road-session.svelte.test.ts);
	// here the road must not move the score beyond that noise.
	expect(Math.abs(onRoad.execution - offRoad.execution)).toBeLessThanOrEqual(5);
	await flat.close();
});
