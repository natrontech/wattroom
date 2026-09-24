import type { Page } from '@playwright/test';
import { expect, test, voicePath } from './crew';
import { signInAs } from './signin';

/**
 * A refused plan time answers beside the field (#2613, errors.md). It was a
 * toast over the picker, which stays open with nothing next to the time that
 * was wrong. The refusal is the server's own shape, answered by a route: the
 * time that earns it is a matter of the clock the test runs at.
 */
const REFUSAL = 'A session is planned between now and three months out.';

async function refuse(page: Page, url: string, method: string): Promise<void> {
	await page.route(url, (route) =>
		route.request().method() === method
			? route.fulfill({
					status: 400,
					json: {
						error: 'validation_error',
						message: REFUSAL,
						field: 'startsAt',
					},
				})
			: route.continue(),
	);
}

test('a refused plan time is answered under the when field', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Refused Planner', '/home');
	const opened = await channels.open(page, `Refused ${Date.now() % 100000}`);
	await schedules.own(page, opened.crew);
	await refuse(page, `**/api/crews/${opened.crew}/schedule`, 'POST');

	await page.goto(voicePath(opened));
	await page.getByRole('button', { name: 'Plan for later' }).click();
	const picker = page.getByRole('dialog');
	await picker.getByRole('listitem').getByRole('button').first().click();
	await picker.getByRole('button', { name: 'Plan it', exact: true }).click();

	await expect(picker.getByRole('alert')).toHaveText(REFUSAL);
	// Another time is the rider's answer, so the refusal steps aside. The
	// field commits on change, which a fill alone does not send.
	await picker.getByLabel('Time').fill('06:15');
	await picker.getByLabel('Time').blur();
	// Gone from the whole page, well inside an error toast's four seconds:
	// said in the picker, not again in a toast over it.
	await expect(page.getByText(REFUSAL)).toHaveCount(0, { timeout: 1_500 });
});

test('a refused move is answered under its own row', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Refused Mover', '/home');
	const opened = await channels.open(page, `Unmoved ${Date.now() % 100000}`);
	await schedules.own(page, opened.crew);
	const status = await page.evaluate(async (crew) => {
		const res = await fetch(`/api/crews/${crew}/schedule`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Unmoved Spin',
				workoutJson: JSON.stringify({
					name: 'Unmoved Spin',
					steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
				}),
				startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
			}),
		});
		return res.status;
	}, opened.crew);
	expect(status).toBe(201);
	await refuse(page, `**/api/crews/${opened.crew}/schedule/*`, 'PATCH');

	await page.goto(`/crew/${opened.crew}/schedule`);
	const row = page.getByRole('listitem').filter({ hasText: 'Unmoved Spin' });
	await row.getByRole('button', { name: 'Move…' }).click();
	await row.getByRole('button', { name: 'Move to this time' }).click();

	await expect(row.getByRole('alert')).toHaveText(REFUSAL);
});
