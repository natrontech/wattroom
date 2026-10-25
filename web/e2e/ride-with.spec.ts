import type { Page } from '@playwright/test';
import { expect, test, voicePath } from './crew';
import { importARoute } from './route';

/**
 * "Ride with <name>" (#3117), on two SimulatedTrainers in one voice channel:
 * both riders imported the same invented climb, so they free-ride one road.
 * The host rides off first; the guest starts at km 0, sees the host on the
 * road, takes "Ride with" and lands at the host's metre, a new lap mid-ride.
 * The guest's ride then saves as one ride, which the server's replay rides
 * from the metre the jump landed on.
 */
const HOST = 'Ride With Host';
const GUEST = 'Ride With Guest';

/** The saver keeps a ride from a minute (docs/SPEC.md's minute rule). */
const A_MINUTE_MS = 65_000;

/** Metres along the road off slot 1's road line, "km 0.4 of 3.0". */
async function metres(page: Page): Promise<number> {
	const text = await page.getByTestId('block-road').innerText();
	const km = /km (\d+\.\d)/.exec(text);
	expect(km, `no km on the road line: ${text}`).not.toBeNull();
	return Number(km![1]) * 1000;
}

/** Onto the stored climb on the free ride, then pedalling on the simulator. */
async function rideTheClimb(page: Page, path: string) {
	await page.goto(path);
	await page.getByRole('button', { name: 'Ride a road' }).click();
	await page
		.getByRole('list', { name: 'your routes' })
		.getByRole('listitem')
		.first()
		.getByRole('button', { name: 'Ride it' })
		.click();
	const fromStart = page.getByRole('button', { name: 'From the start' });
	if (await fromStart.isVisible().catch(() => false)) await fromStart.click();
	await expect(page.getByTestId('block-road')).toContainText('km 0.0');
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
}

test('a free rider rides with a channel-mate: one jump to their metre, then one saved ride', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	const host = await riders(HOST);
	const opened = await channels.open(host, `Ride With ${Date.now() % 100000}`);
	const guest = await riders(GUEST);
	await channels.enter(guest, opened);
	for (const page of [host, guest]) {
		// The flat surface: the setup's road pick and pairing in view.
		await page.evaluate(() =>
			localStorage.setItem('wattroom.world.mode.v1', 'flat'),
		);
		await importARoute(page);
	}
	const training = `${voicePath(opened)}/training`;

	await rideTheClimb(host, training);
	await expect
		.poll(() => metres(host), { timeout: 90_000 })
		.toBeGreaterThanOrEqual(200);

	await rideTheClimb(guest, training);
	const rideWith = guest.getByRole('button', { name: `Ride with ${HOST}` });
	await rideWith.click({ timeout: 20_000 });
	// At the host's metre: within the tick the jump read it from, and beside
	// them from then on, so the offer is gone.
	await expect
		.poll(async () => Math.abs((await metres(guest)) - (await metres(host))), {
			timeout: 10_000,
		})
		.toBeLessThanOrEqual(100);
	await expect(rideWith).toHaveCount(0);
	const landed = await metres(guest);

	// One ride, the jump a lap the server accepts.
	await guest.waitForTimeout(A_MINUTE_MS);
	const ended = await metres(guest);
	await guest.getByRole('button', { name: 'End ride' }).click();
	await expect(guest.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});
	const ride = await guest.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { distanceM?: number }[];
		};
		return rides[0];
	});
	// The metres pedalled since the jump, and the few before it: never the
	// 200 m and more jumped. The road line's tenths of a km set the slack.
	expect(ride.distanceM).toBeGreaterThan(ended - landed - 100);
	expect(ride.distanceM).toBeLessThan(ended - landed + 150);
});
