import { expect, test, voicePath } from './crew';

/**
 * A crew member standing in another of the crew's voice channels is online,
 * just not here — the people column says where, instead of calling them
 * offline (#2536).
 */
const A = 'Elsewhere Here';
const B = 'Elsewhere There';

test("the people column names a member's other channel, not offline", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	await a.setViewportSize({ width: 1440, height: 900 });
	const n = Date.now() % 100000;
	const there = await channels.open(a, `Elsewhere There ${n}`);
	const here = await channels.open(a, `Elsewhere Here ${n}`);

	const b = await riders(B);
	// B comes in by the crew's door and stands in the other voice channel.
	await channels.enter(b, there);

	await a.goto(voicePath(here));
	const column = a
		.getByRole('complementary')
		.filter({ hasText: /offline|in another channel/ });
	await expect(column.getByText('in another channel — 1')).toBeVisible({
		timeout: 15_000,
	});
	const row = column.getByRole('listitem').filter({ hasText: B });
	await expect(row).toContainText(`in ${there.name}`);
	// And nobody is listed offline: both riders are connected somewhere.
	await expect(column.getByText(/^offline —/)).toHaveCount(0);
});
