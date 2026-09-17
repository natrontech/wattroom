import { expect, test } from './room';

/**
 * Home's "Around right now" chip says where a friend is, in the app's one
 * presence vocabulary ($lib/status, #807) — not a mark of its own.
 *
 * It drew RidingBars for anyone in a room, and those bars say "riding now" to
 * the eye and to a screen reader (#2168). So a friend standing in a room's
 * chat was reported as pedalling, while the Friends page called the same
 * person "in a room" — the drift #807 and #1653 each removed once already,
 * and ADR-0012's rule that presence never implies watts.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Home Presence';
const B = 'Home Presence Pal';

test('a friend who is in a room but not pedalling is not shown as riding', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const b = await riders(B);
	const room = await rooms.open(a, `Home Presence ${Date.now() % 100000}`);

	// Friends by code: a request by id wants a shared room, and the chip is
	// about friends (friends.go).
	const code = await b.evaluate(() =>
		fetch('/api/friends')
			.then((res) => res.json())
			.then((f) => String(f.code ?? '')),
	);
	const myId = await a.evaluate(() =>
		fetch('/api/me')
			.then((res) => res.json())
			.then((me) => String(me.id ?? '')),
	);
	// 409 is "already" — these two riders are this spec's own and stable, so
	// the second run of it finds the friendship the first one made (#2133's
	// lesson about state that outlives a run). What matters is the end state.
	const asked = await a.evaluate(
		(c) =>
			fetch('/api/friends', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ code: c }),
			}).then((res) => res.status),
		code,
	);
	expect([200, 201, 204, 409], `the friend request: ${asked}`).toContain(asked);
	const accepted = await b.evaluate(
		(id) =>
			fetch(`/api/friends/${id}/accept`, { method: 'POST' }).then(
				(res) => res.status,
			),
		myId,
	);
	expect([200, 204, 404, 409], `the peer accepting: ${accepted}`).toContain(
		accepted,
	);
	expect(
		await a.evaluate(
			(id) =>
				fetch('/api/friends')
					.then((res) => res.json())
					.then((f) =>
						(f.friends ?? []).some(
							(x: { id?: string; status?: string }) =>
								x.id === id && x.status === 'accepted',
						),
					),
			await b.evaluate(() =>
				fetch('/api/me')
					.then((res) => res.json())
					.then((me) => String(me.id ?? '')),
			),
		),
		'the two are friends by the end of this',
	).toBe(true);

	// B stands in the room — no trainer, so not riding by anyone's definition.
	await rooms.enter(b, room);

	await a.goto('/home');
	// Scoped to the page: the sidebar carries the same names.
	const chip = a
		.getByTestId('page-body')
		.getByRole('listitem')
		.filter({ hasText: B });
	await expect(chip).toBeVisible({ timeout: 15_000 });
	// The badge Avatar draws, with the word the rest of the app uses. The
	// assertion that fails is the label: "riding now" is what RidingBars says.
	await expect(chip.getByLabel('riding now')).toHaveCount(0);
	await expect(chip.getByTitle('riding now')).toHaveCount(0);
});
