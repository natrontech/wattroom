import { expect, test } from './crew';

/**
 * Banned while the crew's own page is open (#2880, L5-14): the next read of it
 * answers not_found, and that is the first load's answer, permanently. The
 * page used to keep the crew's code, its roster and "Leave the crew" beside a
 * "No crew lives here. Retry" that could never succeed (#1677).
 */
const A = 'Crew Page Owner';
const B = 'Crew Page Banned';

test('a rider banned on the crew page is shown the way Home, not the crew', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Crew Page ${Date.now() % 100000}`);
	const b = await riders(B);
	const bId = await b.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id)),
	);
	const setRole = (role: string) =>
		a.evaluate(
			({ crew, userId, role }) =>
				fetch(`/api/crews/${crew}/role`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ userId, role }),
				}).then((res) => res.status),
			{ crew: opened.crew, userId: bId, role },
		);
	// Both riders and the crew are this spec's own and reused (#2133), so a
	// run that died after the ban left B banned for every run after it.
	await setRole('member');

	await channels.enter(b, opened);
	await b.goto(`/crew/${opened.crew}`);
	const main = b.getByRole('main');
	await expect(
		main.getByRole('button', { name: 'Leave the crew' }),
	).toBeVisible();

	try {
		expect(await setRole('banned')).toBeLessThan(300);
		await expect(main.getByText('No crew lives here.')).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			main.getByRole('button', { name: 'Leave the crew' }),
		).toHaveCount(0);
		await expect(main.getByRole('button', { name: 'Retry' })).toHaveCount(0);
		await main.getByRole('link', { name: 'Home', exact: true }).click();
		await expect(b).toHaveURL(/\/home$/);
	} finally {
		expect(await setRole('member')).toBeLessThan(300);
	}
});
