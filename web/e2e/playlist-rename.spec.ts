import { expect, test } from './room';

/**
 * Renaming a room playlist is the coach's and the owner's (docs/SPEC.md's
 * roles matrix), and the row's name was a button for everyone (#2162): a
 * member could open the box, type, blur, and read the server's refusal under
 * the row. ux.md: never render a control that fails on click.
 *
 * Both sides, because the gate is only right if it still lets the owner in.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Playlist Owner';
const B = 'Playlist Member';
const PLAYLIST = 'Room Mix';

test('only a rider who may rename a room playlist can open its name', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const room = await rooms.open(a, `Playlist Gate ${Date.now() % 100000}`);
	const made = await a.evaluate(
		async ([slug, name]) => {
			const res = await fetch(`/api/rooms/${slug}/playlists`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name }),
			});
			return res.status;
		},
		[room.slug, PLAYLIST],
	);
	expect(made, 'the owner could not create a room playlist').toBe(201);

	const b = await riders(B);
	await rooms.enter(b, room);

	// The Room tab of the jukebox, on both screens.
	for (const rider of [a, b]) {
		await rider.goto(`/r/${room.slug}`);
		// The playlists are a <details> under the jukebox, closed by default.
		await rider.getByText('playlists', { exact: true }).click();
		// role="tab", not a button: the jukebox's Room/Mine pair.
		await rider.getByRole('tab', { name: 'Room', exact: true }).click();
		await expect(rider.getByText(PLAYLIST)).toBeVisible({ timeout: 15_000 });
	}

	// The owner may: the name is the control that opens the box.
	await expect(
		a.getByRole('button', { name: PLAYLIST }),
		'the owner cannot open the playlist name they are allowed to rename',
	).toHaveCount(1);
	// The member may not, and is told nothing on click because there is
	// nothing to click.
	await expect(
		b.getByRole('button', { name: PLAYLIST }),
		'a member is offered a rename the server will refuse',
	).toHaveCount(0);
});
