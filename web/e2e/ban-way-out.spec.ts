import { expect, test } from './crew';

/**
 * Banned while standing in a voice channel, a rider's page says the crew is
 * gone for them — and its way out has to open a page that exists (#2537).
 * "Back to the crew" led to the same 404 again.
 */
const A = 'Way Out Owner';
const B = 'Way Out Banned';

test('a rider banned mid-channel is shown the way Home', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Way Out ${Date.now() % 100000}`);
	const b = await riders(B);
	// channels.enter leaves B standing in the voice channel.
	await channels.enter(b, opened);
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
	expect(await setRole('banned')).toBeLessThan(300);

	const page = b.getByRole('main');
	await expect(page.getByText('No crew lives here.')).toBeVisible({
		timeout: 15_000,
	});
	await expect(
		page.getByRole('link', { name: 'Back to the crew' }),
	).toHaveCount(0);
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await expect(b).toHaveURL(/\/home$/);

	// Lifted, so the fixture can hand the crew back.
	expect(await setRole('member')).toBeLessThan(300);
});
