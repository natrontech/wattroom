import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './signin';

/**
 * Nothing outside a room may scroll sideways on a phone (#1008).
 *
 * The obvious assertion — `documentElement.scrollWidth <= clientWidth` — is
 * useless in this app, and measurably so: the shell wraps the page in
 * `overflow-hidden` columns, so a chart 307px wider than a 375px viewport left
 * the document at exactly 375 and the check green. The overflow is absorbed by
 * `[data-testid=page-body]`, which is therefore what has to be measured.
 *
 * A widget that genuinely needs to be wide — a table, a long row — wraps
 * itself in its own `overflow-x: auto` and does not widen the body, so this
 * stays true without exempting anything.
 */
const PHONE = { width: 375, height: 812 };

/** Every route a rider reaches without a room. The room has its own spec. */
const ROUTES = [
	'/home',
	'/workouts',
	'/workouts/edit',
	'/history',
	'/rooms',
	'/friends',
	'/messages',
	'/sessions',
	'/pair',
	'/profile',
	'/trophies',
	'/whats-new',
];

test.use({ viewport: PHONE });

/**
 * A rider with no rides has no charts, and the charts are what overflowed.
 * Without this the spec passes against the very bug it exists to catch —
 * confirmed by running it against the unfixed code, where it went green.
 */
async function seedARide(page: Page): Promise<void> {
	const ok = await page.evaluate(async () => {
		const res = await fetch('/api/rides', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Phone Width Ride',
				// Parsed server-side and required to yield a segment, so it is a
				// real workout rather than an empty string.
				workoutJson: JSON.stringify({
					name: 'Phone Width Ride',
					author: 'e2e',
					steps: [{ type: 'steady', seconds: 120, target: 0.8 }],
				}),
				startedAt: new Date(Date.now() - 3_600_000).toISOString(),
				samples: Array.from({ length: 120 }, () => ({ watts: 200 })),
			}),
		});
		return res.ok;
	});
	if (!ok) throw new Error('could not seed a ride for the chart pages');
}

test('no page outside a room scrolls sideways on a phone', async ({ page }) => {
	await signInAs(page, 'Phone Width', '/home');
	await seedARide(page);

	const wide: string[] = [];
	for (const route of ROUTES) {
		await page.goto(route);
		const body = page.getByTestId('page-body');
		await expect(body).toBeVisible();
		// The charts size themselves from their measured container, so read
		// after layout has settled rather than on the first frame.
		await page.waitForTimeout(300);
		const excess = await body.evaluate(
			(el) => el.scrollWidth - el.clientWidth,
		);
		if (excess > 0) wide.push(`${route} overflows by ${excess}px`);
	}

	expect(wide, 'pages wider than a 375px phone').toEqual([]);
});
