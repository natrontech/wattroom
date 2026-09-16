import { expect, test } from './room';

/**
 * One question, one answer (#2176): has this rider anywhere to open a room?
 *
 * Home's button asked "are you in any crew at all", which is true for a plain
 * member of somebody else's — so they were offered **Open a room** and handed
 * a sheet led by "Join a crew with a code". The dialog between the two asked
 * nothing and called itself "Open a room" whatever the button said.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Join Gate Host';
const B = 'Join Gate Member';

test('a rider who administers no crew is offered joining one, all the way through', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const room = await rooms.open(a, `Join Gate ${Date.now() % 100000}`);
	const b = await riders(B);
	// B is in A's crew and owns none: the case the three surfaces disagreed on.
	await rooms.enter(b, room);

	await b.goto('/home');
	const button = b.getByRole('button', { name: 'Join a crew', exact: true });
	await expect(button).toBeVisible({ timeout: 15_000 });
	await button.click();
	// The dialog says what was pressed.
	await expect(b.getByRole('dialog', { name: 'Join a crew' })).toBeVisible();

	// And the owner, who has somewhere to open one, is offered that instead.
	await a.goto('/home');
	await expect(
		a.getByRole('button', { name: 'Open a room', exact: true }).first(),
	).toBeVisible({ timeout: 15_000 });
});
