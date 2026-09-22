import { expect, test } from './room';

/**
 * Which rider Home leads with joining (#2176, #2184): the one carrying an
 * invite, and only them.
 *
 * #2176 made one predicate of three — the button's word, the dialog's name and
 * the sheet's order — and keyed it on "has this rider anywhere to open a
 * room". That is true of the stranger who arrived off the signed-out landing
 * as well as of the invited rider it was written for, so the front door's one
 * CTA (then "Open your first room", now "Start your crew" — #2480) handed
 * every organic arrival a code box. ADR-0038's 2026-09-17 amendment keys it
 * on the invite instead.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Join Gate Host';
const B = 'Join Gate Invited';
const C = 'Join Gate Stranger';

test('the invited rider leads with joining, and the stranger gets the crew the landing promised', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const room = await rooms.open(a, `Join Gate ${Date.now() % 100000}`);

	// B was sent to the crew's door and walked away without going through it:
	// the invite is kept on the account (#2144), and it is the whole audience
	// this order is for.
	const b = await riders(B);
	await b.goto(`/c/${room.code}`);
	await b.waitForResponse(
		(res) =>
			res.url().includes('/remember') && res.request().method() === 'POST',
		{ timeout: 15_000 },
	);
	await b.goto('/home');
	const joining = b.getByRole('button', { name: 'Join a crew', exact: true });
	await expect(joining).toBeVisible({ timeout: 15_000 });
	await joining.click();
	// The dialog says what was pressed.
	await expect(b.getByRole('dialog', { name: 'Join a crew' })).toBeVisible();

	// C was sent nowhere — the stranger the landing speaks to, in no crew and
	// with no invite. Before #2184 this rider met "Join a crew" too.
	const c = await riders(C);
	await c.goto('/home');
	// The big button is the first of the two words on the page — the sheet's
	// own submit buttons sit below it. Named rather than clicked first, so a
	// regression fails saying which word it found instead of timing out on a
	// disabled form button five minutes later.
	const opening = c
		.getByRole('button', { name: /^(Join a crew|Start a crew)$/ })
		.first();
	await expect(opening).toBeVisible({ timeout: 15_000 });
	await expect(opening).toHaveAccessibleName('Start a crew');
	await opening.click();
	await expect(c.getByRole('dialog', { name: 'Start a crew' })).toBeVisible();

	// And the owner, who administers a crew, is offered the same thing
	// (ADR-0010).
	await a.goto('/home');
	await expect(
		a.getByRole('button', { name: 'Start a crew', exact: true }).first(),
	).toBeVisible({ timeout: 15_000 });
});
