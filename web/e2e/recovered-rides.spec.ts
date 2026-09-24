import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * A crashed ride is offered back where a rider looks (#2616). The only offer
 * sat at the foot of /ride's setup screen, under the FTP field, so a rider
 * who rides sessions or does not scroll never found it. Seeded straight into
 * the crash-safety buffer, as a tab that died mid-ride leaves it.
 */
async function crash(
	page: Page,
	workoutName: string,
	minutesAgo = 30,
): Promise<string> {
	return page.evaluate(
		async ([workoutName, minutesAgo]) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('wattroom-rides', 1);
				request.onupgradeneeded = () => {
					request.result.createObjectStore('samples', {
						keyPath: ['rideId', 'seq'],
					});
					request.result.createObjectStore('rides', { keyPath: 'rideId' });
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const startedAt = Date.now() - minutesAgo * 60_000;
			const rideId = String(startedAt);
			const t = db.transaction(['samples', 'rides'], 'readwrite');
			t.objectStore('rides').put({
				rideId,
				startedAt,
				workoutName,
				workoutJson: JSON.stringify({
					name: workoutName,
					steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
				}),
			});
			for (let seq = 0; seq < 120; seq++)
				t.objectStore('samples').put({
					rideId,
					seq,
					watts: 180,
					cadence: 88,
					heartRate: 0,
					at: startedAt + seq * 1000,
				});
			await new Promise((resolve, reject) => {
				t.oncomplete = resolve;
				t.onerror = () => reject(t.error);
			});
			db.close();
			return rideId;
		},
		[workoutName, minutesAgo] as const,
	);
}

test('a crashed ride is said on Home and saved from Rides', async ({
	page,
}) => {
	// Its own rider (#2133): the test saves a ride to the account, and
	// signInTo returns before the sign-in lands, which raced the goto below.
	await signInAs(page, 'Crash Rescuer', '/home');
	const name = `Crash Spin ${Date.now() % 100000}`;
	await crash(page, name);
	const card = page.getByText(`Recovered an unfinished ride — ${name}`);

	// The ramp's setup offers it too.
	await page.goto('/ramp');
	await expect(card).toBeVisible({ timeout: 15_000 });

	// Home says a ride is waiting, persistently, and where.
	await page.goto('/home');
	await expect(
		page.getByText('A ride never reached your account.'),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('link', { name: 'Open Rides' }).click();
	await page.waitForURL('/history');

	await expect(card).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Save to your account' }).click();
	await expect(card).toHaveCount(0, { timeout: 15_000 });
	// In the list at once: the page reloads it rather than wait for a visit.
	await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
});

/**
 * A ride still being recorded is not a crash (#2617). A tab riding it holds
 * its lock, so the recovery card offered a live ride from a second tab and
 * Save filed half of it. A second page in the same browser stands for that
 * tab. The crashed ride beside it proves the card has read the buffer.
 */
test('a ride another tab is still recording is not offered back', async ({
	page,
	context,
}) => {
	await signInAs(page, 'Other Tab Rider', '/home');
	const stamp = Date.now() % 100000;
	const crashed = `Crashed Spin ${stamp}`;
	const live = `Live Spin ${stamp}`;
	await crash(page, crashed, 40);
	const rideId = await crash(page, live, 20);

	const riding = await context.newPage();
	await riding.goto('/home');
	await riding.evaluate(async (lock) => {
		let granted = () => {};
		const held = new Promise<void>((resolve) => (granted = resolve));
		void navigator.locks.request(lock, () => {
			granted();
			return new Promise(() => {});
		});
		await held;
	}, `wattroom-ride-${rideId}`);

	await page.goto('/history');
	const card = (name: string) =>
		page.getByText(`Recovered an unfinished ride — ${name}`);
	await expect(card(crashed)).toBeVisible({ timeout: 15_000 });
	await expect(card(live)).toHaveCount(0);

	// The tab goes, and its lock with it: now it is a ride to recover.
	await riding.close();
	await page.reload();
	await expect(card(live)).toBeVisible({ timeout: 15_000 });
});
