import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * A crashed ride is offered back where a rider looks (#2616). The only offer
 * sat at the foot of /ride's setup screen, under the FTP field, so a rider
 * who rides sessions or does not scroll never found it. Seeded straight into
 * the crash-safety buffer, as a tab that died mid-ride leaves it.
 */
async function crash(page: Page, workoutName: string): Promise<void> {
	await page.evaluate(async (workoutName) => {
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
		const startedAt = Date.now() - 30 * 60_000;
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
	}, workoutName);
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
