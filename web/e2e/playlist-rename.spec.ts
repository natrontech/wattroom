import { expect, test, voicePath } from './crew';

/**
 * Renaming a crew playlist is the crew's owner's and admins' (docs/SPEC.md's
 * roles matrix, #2439), and the row's name was a button for everyone (#2162): a
 * member could open the box, type, blur, and read the server's refusal under
 * the row. ux.md: never render a control that fails on click.
 *
 * Both sides, because the gate is only right if it still lets the owner in.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Playlist Owner';
const B = 'Playlist Member';
const PLAYLIST = 'Crew Mix';

test('only a rider who may rename a crew playlist can open its name', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Playlist Gate ${Date.now() % 100000}`);
	// The crew outlives the run (a crew with channels is never swept, #2493),
	// and so does its shelf: the last run's playlist goes first, or the row
	// below is two rows.
	await a.evaluate(
		async ([crewId, name]) => {
			const body = await fetch(`/api/crews/${crewId}/playlists`).then((res) =>
				res.json(),
			);
			for (const list of body.playlists as { id: string; name: string }[])
				if (list.name === name)
					await fetch(`/api/crews/${crewId}/playlists/${list.id}`, {
						method: 'DELETE',
					});
		},
		[opened.crew, PLAYLIST],
	);
	const made = await a.evaluate(
		async ([crewId, name]) => {
			const res = await fetch(`/api/crews/${crewId}/playlists`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name }),
			});
			return res.status;
		},
		[opened.crew, PLAYLIST],
	);
	expect(made, 'the owner could not create a crew playlist').toBe(201);

	const b = await riders(B);
	await channels.enter(b, opened);

	// The Crew tab of the voice channel's jukebox, on both screens: a voice
	// channel's shelf is its crew's (#2449).
	for (const rider of [a, b]) {
		await rider.goto(voicePath(opened));
		// The playlists are a <details> under the jukebox, closed by default.
		await rider.getByText('playlists', { exact: true }).click();
		// role="tab", not a button: the jukebox's Crew/Mine pair.
		await rider.getByRole('tab', { name: 'Crew', exact: true }).click();
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
