import { expect, test, voicePath } from './crew';

/**
 * Home's "Around right now" chip says where a friend is, in the app's one
 * presence vocabulary ($lib/status, #807) — not a mark of its own.
 *
 * It drew RidingBars for anyone in a room, and those bars say "riding now" to
 * the eye and to a screen reader (#2168). So a friend standing in a room's
 * chat was reported as pedalling, while the Friends page called the same
 * person "in a room" — the drift #807 and #1653 each removed once already,
 * and ADR-0012's rule that presence never implies watts. A voice channel is
 * where a friend stands now (ADR-0058).
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Home Presence';
const B = 'Home Presence Pal';

test('a friend who is in a voice channel but not pedalling is not shown as riding', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const a = await riders(A);
	const b = await riders(B);
	const opened = await channels.open(a, `Home Presence ${Date.now() % 100000}`);

	// Friends by code: a request by id wants a shared channel, and the chip is
	// about friends (friends.go).
	const code = await b.evaluate(() =>
		fetch('/api/friends')
			.then((res) => res.json())
			.then((f) => String(f.code ?? '')),
	);
	const idOf = (rider: typeof a) =>
		rider.evaluate(() =>
			fetch('/api/me')
				.then((res) => res.json())
				.then((me) => String(me.id ?? '')),
		);
	const myId = await idOf(a);
	const bId = await idOf(b);
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
			bId,
		),
		'the two are friends by the end of this',
	).toBe(true);

	// B stands in the voice channel — no trainer, so not riding by anyone's
	// definition. The crew's own read says B is there first.
	await channels.enter(b, opened);
	await expect
		.poll(
			() =>
				a.evaluate(
					({ crew, voice, id }) =>
						fetch('/api/crews/live')
							.then((res) => res.json())
							.then(
								(body) =>
									body.crews
										?.find((c: { id: string }) => c.id === crew)
										?.channels?.find((c: { id: string }) => c.id === voice)
										?.occupants?.some((o: { id: string }) => o.id === id) ??
									false,
							),
					{ crew: opened.crew, voice: opened.voice, id: bId },
				),
			{ message: `${B} never showed up in the voice channel`, timeout: 15_000 },
		)
		.toBe(true);
	// The premise the regression needs (#2168): the friends feed says B is
	// somewhere — `inVoice`, what the old chip's `inRoom` became (#2516), the
	// flag it drew RidingBars for. A friend read as merely online passes
	// everything below whatever the chip does with a friend who is somewhere.
	await expect
		.poll(
			() =>
				a.evaluate(
					(id) =>
						fetch('/api/friends')
							.then((res) => res.json())
							.then(
								(f) =>
									(f.friends ?? []).find((x: { id?: string }) => x.id === id)
										?.inVoice === true,
							),
					bId,
				),
			{
				message: `A's friends feed never says ${B} is in the voice channel`,
				timeout: 15_000,
			},
		)
		.toBe(true);

	await a.goto('/home');
	// Scoped to the page: the sidebar carries the same names.
	const chip = a
		.getByTestId('page-body')
		.getByRole('listitem')
		.filter({ hasText: B });
	await expect(chip).toBeVisible({ timeout: 15_000 });
	// B stands in a channel A may enter, so the chip names it — crew, then
	// channel — and walks in there (#2516), not into a room and not into the
	// DM it falls back to for a friend somewhere unnamed.
	const link = chip.getByRole('link');
	await expect(link).toHaveAttribute('href', voicePath(opened));
	await expect(link).toHaveAttribute(
		'title',
		new RegExp(`^in .+ · ${opened.name}$`),
	);
	// The badge Avatar draws, with the word the rest of the app uses. The
	// assertion that fails is the label: "riding now" is what RidingBars says.
	await expect(chip.getByLabel('riding now')).toHaveCount(0);
	await expect(chip.getByTitle('riding now')).toHaveCount(0);
});
