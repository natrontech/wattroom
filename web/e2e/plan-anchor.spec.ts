import { expect, test } from './crew';

/**
 * A plan's link lands on its own row (#2608). Home's What's next opened the
 * crew's Home, which shows only the next plan, so Friday's was out of reach
 * behind Tuesday's. The row is the last of eight at phone width, below the
 * fold: the shell scrolls its page column, not the window, so a hash alone
 * scrolled nothing (#1199).
 */
const RIDER = 'Plan Anchor Rider';

test('a plan link scrolls to its row on the Schedule and marks it', async ({
	riders,
	channels,
	schedules,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	const { crew } = await channels.open(page, `Anchor ${Date.now() % 100000}`);
	await schedules.own(page, crew);
	const ids = await page.evaluate(async (crew) => {
		const ids: string[] = [];
		for (let day = 1; day <= 8; day++) {
			const res = await fetch(`/api/crews/${crew}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName: `Anchor Day ${day}`,
					workoutJson: JSON.stringify({
						name: `Anchor Day ${day}`,
						steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
					}),
					startsAt: new Date(Date.now() + day * 24 * 3600_000).toISOString(),
				}),
			});
			ids.push(((await res.json()) as { id: string }).id);
		}
		return ids;
	}, crew);

	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`/crew/${crew}/schedule#plan-${ids[7]}`);
	const row = page.getByRole('listitem').filter({ hasText: 'Anchor Day 8' });
	await expect(row).toHaveAttribute('aria-current', 'true', {
		timeout: 15_000,
	});
	await expect(row).toBeInViewport();
	await expect(
		page.getByRole('listitem').filter({ hasText: 'Anchor Day 1' }),
	).not.toHaveAttribute('aria-current');
});
