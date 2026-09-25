import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * A crashed ride is offered back where a rider looks (#2616). The only offer
 * sat at the foot of /ride's setup screen, under the FTP field, so a rider
 * who rides sessions or does not scroll never found it. Seeded straight into
 * the crash-safety buffer, as a tab that died mid-ride leaves it: the
 * signed-in rider's own, unless `unstamped` makes it a ride buffered before
 * rides named their rider (#2805).
 */
async function crash(
	page: Page,
	workoutName: string,
	minutesAgo = 30,
	unstamped = false,
): Promise<string> {
	return page.evaluate(
		async ([workoutName, minutesAgo, unstamped]) => {
			const me = await fetch('/api/me').then((res) => res.json());
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
				...(unstamped ? {} : { ownerId: me.id }),
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
		[workoutName, minutesAgo, unstamped] as const,
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

/** The LTHR on the signed-in account, null for none. */
const accountLthr = (page: Page) =>
	page.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => (me.lthr as number | undefined) ?? null),
	);

/** Sets or clears (0) the signed-in account's LTHR, the way the settings save does. */
async function setLthr(page: Page, lthr: number): Promise<void> {
	const status = await page.evaluate(async (lthr) => {
		const me = await fetch('/api/me').then((res) => res.json());
		const res = await fetch('/api/me', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				displayName: me.displayName,
				ftpWatts: me.ftpWatts,
				weightKg: me.weightKg,
				lthr,
			}),
		});
		return res.status;
	}, lthr);
	expect(status).toBe(200);
}

/** Whose numbers the browser's profile cache holds, once the pull has run. */
const cachedFor = (page: Page) =>
	page.evaluate(
		() =>
			JSON.parse(localStorage.getItem('wattroom.profile.v1') ?? '{}')
				.ownerId as string | undefined,
	);

/**
 * One laptop beside one trainer, two riders (#2805). Ana's crashed ride —
 * heart rate and all — was offered to Ben with a Save that filed it into his
 * history, and her cached LTHR was written onto his account the moment the
 * app booted. Ben signs in over her session, with no sign-out between, the
 * way an expired cookie or a second sign-in swaps the account.
 */
test("a crashed ride on a shared browser is its rider's alone", async ({
	page,
	browser,
}) => {
	// Ben has never set an LTHR. Cleared from a browser of his own: the shared
	// one pulls whoever the cookie names the moment it changes, and would cache
	// whatever an earlier run left on his account as his.
	const his = await browser.newPage();
	await signInAs(his, 'Shared Laptop Ben', '/api/me');
	await setLthr(his, 0);
	await his.close();

	const stamp = Date.now() % 100000;
	const hers = `Ana Spin ${stamp}`;
	const nobodys = `Unstamped Spin ${stamp}`;
	const card = (name: string) =>
		page.getByText(`Recovered an unfinished ride — ${name}`);

	await signInAs(page, 'Shared Laptop Ana', '/home');
	await setLthr(page, 171);
	const ana = await page.evaluate(() =>
		fetch('/api/me').then((res) => res.json()),
	);
	// The pull caches her 171 in this browser, under her name.
	await page.reload();
	await expect.poll(() => cachedFor(page)).toBe(ana.id);
	await crash(page, hers, 40);
	await crash(page, nobodys, 20, true);

	await signInAs(page, 'Shared Laptop Ben', '/history');
	const ben = await page.evaluate(() =>
		fetch('/api/me').then((res) => res.json()),
	);
	await expect.poll(() => cachedFor(page)).toBe(ben.id);
	expect(await accountLthr(page)).toBeNull();

	// The ride nobody's name is on proves the card read the buffer: offered
	// to download, never to save into whoever is here.
	await expect(card(nobodys)).toBeVisible({ timeout: 15_000 });
	await expect(
		page.getByRole('button', { name: 'Save to your account' }),
	).toHaveCount(0);
	await expect(card(hers)).toHaveCount(0);

	// Ana back: her ride waited for her, Save and all.
	await signInAs(page, 'Shared Laptop Ana', '/history');
	await expect(card(hers)).toBeVisible({ timeout: 15_000 });
	await expect(
		page.getByRole('button', { name: 'Save to your account' }),
	).toHaveCount(1);
});
