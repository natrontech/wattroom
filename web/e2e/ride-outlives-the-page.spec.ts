import type { Page } from '@playwright/test';
import { expect, test, textPath, voicePath } from './crew';
import { signInAs } from './signin';

/**
 * A ride is the rider's, and navigation never ends it (WATTROOM.md, #4259
 * box 3): a ride alone walks through a text channel, a voice channel and
 * the crew's pages with no "End the ride?" in the way, comes back to its
 * screen still riding, and is saved once.
 */

/** In-app navigation: the router's, so the app shell and its ride stay. */
async function walk(page: Page, path: string): Promise<void> {
	await page.evaluate((to) => {
		const a = document.createElement('a');
		a.href = to;
		document.body.append(a);
		a.click();
		a.remove();
	}, path);
	await expect(page).toHaveURL((url) => url.pathname === path.split('?')[0]);
}

const rides = (page: Page) =>
	page.evaluate(async () => {
		const body = (await fetch('/api/rides').then((res) => res.json())) as {
			rides?: unknown[];
		};
		return body.rides?.length ?? 0;
	});

test('a ride alone passes through channels and crew pages, and saves once', async ({
	page,
	channels,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await signInAs(page, 'Ride Passes Through', '/home');
	const opened = await channels.open(
		page,
		`Passes Through ${Date.now() % 100000}`,
	);
	const before = await rides(page);

	// Asked for nothing on the way: there is no guard left to ask.
	let asked = 0;
	page.on('dialog', (dialog) => {
		asked++;
		void dialog.dismiss();
	});

	await walk(page, '/ride?w=smoke-test');
	await expect(page.getByRole('heading', { name: 'Smoke Test' })).toBeVisible();
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page.getByText('Simulated Trainer').locator('..').getByText(/\d+ W/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const clock = page.getByTestId('ride-clock');
	await expect(clock).toBeVisible({ timeout: 15_000 });

	for (const path of [
		textPath(opened),
		voicePath(opened),
		`/crew/${opened.crew}`,
		'/home',
	]) {
		await walk(page, path);
		// No "End the ride?" on the way: the confirm is the app's own dialog.
		await expect(page.getByText('End the ride?')).toHaveCount(0);
	}

	// Back on its screen, still the same ride: its clock has moved on.
	await walk(page, '/ride');
	await expect(clock).toBeVisible();
	const at = await clock.innerText();
	await expect(clock).not.toHaveText(at, { timeout: 10_000 });

	// The one-minute workout ends on its own and is saved, once.
	await expect(page.getByRole('link', { name: 'See your ride' })).toBeVisible({
		timeout: 120_000,
	});
	expect(await rides(page)).toBe(before + 1);
	expect(asked).toBe(0);
});
