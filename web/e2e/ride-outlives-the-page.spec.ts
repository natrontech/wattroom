import type { Page } from '@playwright/test';
import { expect, test, textPath, voicePath } from './crew';

/**
 * A ride is the rider's (ADR-0093, #4259): riding alone, the rider reads
 * their crew's text channel, opens its voice channel and another crew's, and
 * comes back to the ride still running. No page asks to end it, and the
 * ride saves once.
 */
const RIDER = 'Ride Roams Rider';
const OTHER = 'Ride Roams Host';
// The smoke workout is just over a minute, the least the server keeps.
const ITS_END_MS = 120_000;

/**
 * An in-app navigation, as a link in the sidebar makes one: the router's
 * own, so a guard would see it and the ride in memory survives it. A
 * page.goto would reload the app and rightly lose the ride.
 */
async function follow(page: Page, path: string): Promise<void> {
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		document.body.append(link);
		link.click();
		link.remove();
	}, path);
	await page.waitForURL((url) => url.pathname === path, { timeout: 15_000 });
	await expect(
		page.getByRole('dialog'),
		`opening ${path} asked something mid-ride`,
	).toHaveCount(0);
}

test('a ride alone runs on through a text channel, a voice channel and another crew, and saves once', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(4 * 60_000);

	const host = await riders(OTHER);
	const elsewhere = await channels.open(
		host,
		`Roams Away ${Date.now() % 100000}`,
	);
	const page = await riders(RIDER);
	const home = await channels.open(page, `Roams Home ${Date.now() % 100000}`);
	await channels.enter(page, elsewhere);

	const since = Date.now() - 1_000;
	await page.goto('/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page
			.getByText('Simulated Trainer')
			.locator('..')
			.getByText(/\d+ W · \d+ rpm/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const end = page.getByRole('button', { name: 'End ride' });
	await expect(end).toBeVisible({ timeout: 15_000 });

	await follow(page, textPath(home));
	await follow(page, voicePath(home));
	await follow(page, voicePath(elsewhere));
	// The ride is a place the rider opens: a voice channel's Training page
	// draws it, never a second setup.
	await follow(page, `${voicePath(home)}/training`);
	await expect(end, 'the channel offered a second ride').toBeVisible();
	await follow(page, '/ride');
	await expect(end, 'the ride ended when its page closed').toBeVisible();

	// The workout runs to its own end, which saves it.
	await expect(
		page.getByRole('link', { name: 'See your ride' }),
		'the ride did not save',
	).toBeVisible({ timeout: ITS_END_MS });

	const saved = await page.evaluate(async (since) => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { startedAt: string }[];
		};
		return rides.filter((r) => Date.parse(r.startedAt) >= since).length;
	}, since);
	expect(saved, 'the ride saved as more than one').toBe(1);
});
