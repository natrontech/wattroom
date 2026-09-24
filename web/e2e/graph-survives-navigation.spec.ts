import type { Page } from '@playwright/test';
import { expect, test, voicePath } from './crew';

/**
 * The ride's power line survives a walk to another page and back (#2654).
 *
 * The recording lives on the channel's connection, which outlives every page;
 * the edge into a session that clears it was detected by a component the
 * shell mounts once per visit, so coming back mid-ride read as a new session
 * and the line restarted from the return. Nothing threw — the graph simply
 * began later — so this reads where the line begins, before and after.
 */

const RIDER = 'Graph Survives Rider';

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;
/** Slack over a live wait — the browser's timer drift, plus a 1 Hz tick. */
const SETTLE_MS = 20_000;

/** Every point of the ride's power line, as the graph draws it. */
async function line(page: Page): Promise<{ first: number; points: number }> {
	return page.locator('polyline.text-ink').evaluateAll((lines) => {
		const xs = lines.flatMap((l) =>
			(l.getAttribute('points') ?? '')
				.split(' ')
				.filter(Boolean)
				.map((p) => Number(p.split(',')[0])),
		);
		return { first: xs.length ? Math.min(...xs) : NaN, points: xs.length };
	});
}

test('leaving the ride for another page and coming back keeps its power line', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	await page.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(
		page,
		`Graph Survives ${Date.now() % 100000}`,
	);

	await page.goto(`${voicePath(opened)}/training`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start a session' }).click();
	await page
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await page
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Start Recovery Spin' }).click();
	await page.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 15_000 });

	// A few seconds of line, so a restart would begin visibly later.
	await expect
		.poll(async () => (await line(page)).points, {
			message: 'the ride never drew a power line',
			timeout: COUNTDOWN_MS + SETTLE_MS,
		})
		.toBeGreaterThanOrEqual(5);
	const before = await line(page);

	// Another page, in the app — a navigation, not a reload, which would
	// rightly lose an in-memory recording along with everything else.
	const ride = page.url();
	await page
		.locator('nav[aria-label="crews and channels"]')
		.getByRole('link', { name: /^\s*Workouts\s*$/i })
		.click();
	await expect(page).toHaveURL(/\/workouts$/);
	await page.goBack();
	await expect(page).toHaveURL(ride);

	await expect
		.poll(async () => (await line(page)).points, {
			message: 'the ride drew no power line after the return',
			timeout: SETTLE_MS,
		})
		.toBeGreaterThan(0);
	expect(
		(await line(page)).first,
		'the power line restarted from the return',
	).toBe(before.first);
});
