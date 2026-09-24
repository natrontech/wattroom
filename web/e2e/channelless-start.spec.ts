import { expect, test } from './crew';

/**
 * Start now on a plan with no voice channel asks where, on its own row
 * (#2607). It used to be greyed with only a tooltip — "Pick a voice channel
 * above", pointing at a control that had moved into the picker — and a touch
 * screen never shows a tooltip at all.
 */
const RIDER = 'Channelless Start Rider';

test('a plan that names no channel starts in one chosen on its row', async ({
	riders,
	channels,
	schedules,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	const opened = await channels.open(page, `Nowhere ${Date.now() % 100000}`);
	await schedules.own(page, opened.crew);
	const workoutName = `Nowhere Spin ${Date.now() % 1000}`;
	const status = await page.evaluate(
		async ({ crew, workoutName }) => {
			const res = await fetch(`/api/crews/${crew}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName,
					workoutJson: JSON.stringify({
						name: workoutName,
						steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
					}),
					// Due, and naming no voice channel.
					startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
				}),
			});
			return res.status;
		},
		{ crew: opened.crew, workoutName },
	);
	expect(status).toBe(201);

	await page.goto(`/crew/${opened.crew}/schedule`);
	const row = page.getByRole('listitem').filter({ hasText: workoutName });
	// Where it runs is asked on the row, and the button says where.
	const start = row.getByRole('button', { name: /^Start in / });
	await expect(start).toBeEnabled({ timeout: 15_000 });
	await expect(row.getByRole('button', { name: 'Start now' })).toHaveCount(0);

	await start.click();
	await page.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 30_000 });
});
