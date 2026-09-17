import { expect, test } from './room';
import { signInAs } from './signin';

/**
 * Home's "What's next" is one row per planned SESSION, across rooms (#1693).
 *
 * ADR-0020 retired `/sessions` into Home because "a cross-room list of what is
 * coming is the second half of what is happening". What landed rendered the
 * rail feed's `next` — one row per ROOM — so a room with three plans this week
 * showed one of them on the page while the same rider's calendar feed, built
 * from the same query, listed all three. The three plans below are one room's
 * on purpose: that is precisely the case the old list collapsed.
 *
 * And the row is not the room's row: saying you are in stays with the planning,
 * in the room whose session it is, so no "I'm in" reaches Home.
 */
test('Home lists every planned session, not one per room', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Whats Next', '/home');
	const stamp = Date.now() % 100000;
	const { slug } = await rooms.open(page, `Whats Next ${stamp}`);

	// Planned back to front, so the assertion below also catches a list that
	// renders in whatever order the rows arrived in.
	const names = [`Thursday ${stamp}`, `Tuesday ${stamp}`, `Wednesday ${stamp}`];
	const hours = [72, 24, 48];
	for (const [i, workoutName] of names.entries()) {
		const planned = await page.evaluate(
			async ({ slug, workoutName, hours }) => {
				const res = await fetch(`/api/rooms/${slug}/schedule`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						workoutName,
						workoutJson: JSON.stringify({
							name: workoutName,
							steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
						}),
						startsAt: new Date(Date.now() + hours * 3600_000).toISOString(),
					}),
				});
				return res.ok;
			},
			{ slug, workoutName, hours: hours[i] },
		);
		expect(planned, `could not plan ${workoutName}`).toBe(true);
	}

	await page.goto('/home');
	const list = page.getByTestId('whats-next');
	await expect(list.getByRole('listitem')).toHaveCount(3);

	// Every plan, in the order they are ridden — and each says which room it is
	// in, which is the only thing a cross-room list has to add.
	const rowText = await list
		.getByRole('listitem')
		.evaluateAll((all) => all.map((li) => li.textContent ?? ''));
	expect(rowText.map((text) => text.replace(/\s+/g, ' '))).toEqual([
		expect.stringContaining(`Tuesday ${stamp}`),
		expect.stringContaining(`Wednesday ${stamp}`),
		expect.stringContaining(`Thursday ${stamp}`),
	]);
	expect(rowText.join(' ')).toContain(`Whats Next ${stamp}`);

	// RSVP is a room surface (ADR-0020, decided 2026-09-17) — the room's own
	// Sessions place has the button, Home does not.
	await expect(list.getByRole('button', { name: /I'm in/ })).toHaveCount(0);
	await page.goto(`/r/${slug}/sessions`);
	await expect(
		page.getByRole('button', { name: /I'm in/ }).first(),
	).toBeVisible();
});
