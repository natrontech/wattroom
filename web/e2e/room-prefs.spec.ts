import { expect, test } from './room';

/**
 * A rider's own settings for a room (#1100): they save, and a refused save
 * says so and puts back what the server actually holds — including a change
 * that saved a moment earlier (#2163).
 *
 * The first half is not ceremony. The PATCH went out with a raw string body,
 * so fetch stamped it text/plain and httpx.DecodeStrict refused it as a form
 * encoding — every press was a 400 and neither switch had ever saved.
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Room Prefs Rider';

test('a room preference saves, and a refused one does not undo what did', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const room = await rooms.open(a, `Room Prefs ${Date.now() % 100000}`);
	await a.goto(`/r/${room.slug}/settings`);

	const notify = a.getByRole('checkbox', { name: /Notify me about this room/ });
	const board = a.getByRole('checkbox', { name: /Include me on the weekly/ });
	await expect(notify).toBeChecked();
	await expect(board).toBeChecked();

	// It saves — asserted against the server, not the switch.
	await notify.uncheck();
	await expect
		.poll(() =>
			a.evaluate(
				(slug) =>
					fetch(`/api/rooms/${slug}`)
						.then((res) => res.json())
						.then((r) => r.me?.notify),
				room.slug,
			),
		)
		.toBe(false);

	// And a refused save puts back what the server holds — which now includes
	// the change above. It used to reset both switches to the snapshot the
	// page was loaded with, so a saved "off" read as "on".
	await a.route(
		(url) => url.pathname === `/api/rooms/${room.slug}/me`,
		(route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({
					error: 'internal_error',
					message: 'Could not save that.',
				}),
			}),
	);
	// `click`, not `uncheck`: uncheck asserts the box ENDS unchecked, and the
	// whole point is that a refused save puts it back.
	await board.click();
	await expect(a.getByText('Could not save that.')).toBeVisible();
	await expect(board, 'the refused switch went back').toBeChecked();
	await expect(notify, 'the saved switch stayed saved').not.toBeChecked();
});
