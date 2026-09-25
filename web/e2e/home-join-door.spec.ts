import { expect, test } from './crew';

/**
 * A code typed on Home opens the crew's door, never the crew (#2810).
 *
 * ADR-0036, amended with ADR-0058, says a crew's weekly board at the door so
 * that nobody is enrolled on it just by joining — and `on_board` defaults to
 * true on exactly that premise. The code box on Home and behind the sidebar's
 * + joined on its own: a rider who typed a code there was ranked on a board
 * no sentence had mentioned. This is that journey against a crew whose board
 * is on, where the gap was: the sentence before the join, and no membership
 * until the door's own button.
 */

/** This spec's own two riders (#2133); letters and spaces only (auth.go). */
const A = 'Home Door Host';
const B = 'Home Door Guest';

test("a code typed on Home meets the crew's door, and its board, before the join", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Home Door ${Date.now() % 100000}`);
	// The board is off until the crew turns it on (ADR-0036), so this crew
	// turns it on — every run, since the host's crew is kept across runs.
	const turnedOn = await a.evaluate(async (id) => {
		const crew = await fetch(`/api/crews/${id}`).then((res) => res.json());
		const res = await fetch(`/api/crews/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: crew.name, boardEnabled: true }),
		});
		return res.status;
	}, opened.crew);
	expect(turnedOn, 'the host could not turn the board on').toBe(200);

	const b = await riders(B);
	await b.goto('/home');

	// A code no crew can have — the alphabet has no 0 (shared.go) — is
	// refused beside the box it was typed in, not on a page of its own.
	await b.locator('#join-code').fill('000000');
	await b.getByRole('button', { name: 'Join crew' }).click();
	await expect(b.getByText('No crew has that code')).toBeVisible();
	await expect(b).toHaveURL(/\/home$/);

	await b.locator('#join-code').fill(opened.code);
	await b.getByRole('button', { name: 'Join crew' }).click();

	// The door, and the board said out loud on it, before anything is joined.
	await b.waitForURL(new RegExp(`/c/${opened.code}$`), { timeout: 15_000 });
	await expect(
		b.getByText(/This crew keeps a weekly board: your kJ and time are ranked/),
	).toBeVisible();
	const outside = await b.evaluate(
		(id) => fetch(`/api/crews/${id}/members`).then((res) => res.status),
		opened.crew,
	);
	expect(outside, 'the code box joined before the door was read').toBe(404);

	// The door's own button is the join, and it lands on the crew (#2456).
	await b
		.getByRole('main')
		.getByRole('button', { name: /^Join / })
		.click();
	await b.waitForURL(new RegExp(`/crew/${opened.crew}$`), { timeout: 15_000 });
	const me = await b.evaluate(
		(id) =>
			fetch(`/api/crews/${id}/members`)
				.then((res) => res.json())
				.then((body) => body.me),
		opened.crew,
	);
	// On the board, as the door said — told first, which is the whole point.
	expect(me?.onBoard).toBe(true);
});
