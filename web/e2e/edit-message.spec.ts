import { expect, test } from './room';

/**
 * Editing a sent line (#865), in a real browser and across two real sessions.
 *
 * The unit tests cover the pieces: the endpoint's refusals, the tick handler
 * that rewrites a line in the log, the DM poll that carries an edit `after`
 * can never bring back. What none of them can reach is the thing the feature
 * actually promises — that the words change on somebody ELSE's screen, and
 * that they can see they changed. That path runs through the hub's tick, and
 * the only way to watch it is with a second rider holding the room open.
 */

/** The second dev rider. `?as=` accepts letters and spaces (auth.go). */
const B = 'Ruben';

const SENT = 'warmup at 6 sharp';
const FIXED = 'warmup at 7 sharp';

test('a rider fixes their line and the room sees the new words', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders();
	const name = `Edit Message ${Date.now() % 100000}`;
	const room = await rooms.open(a, name);

	const b = await riders(B);
	await b.goto('/home#rooms');
	await b.locator('#join-code').fill(room.code);
	await b.getByRole('button', { name: 'Join room' }).click();
	await expect(
		b.getByRole('heading', { name }),
		`${B} never landed in "${name}" with the code ${room.code}`,
	).toBeVisible({ timeout: 15_000 });

	// Both standing in the room's chat, so both are on the tick.
	for (const rider of [a, b]) await rider.goto(`/r/${room.slug}/chat`);

	const draft = a.getByPlaceholder(`Message ${name}…`);
	await expect(draft).toBeVisible();
	await draft.fill(SENT);
	await draft.press('Enter');

	// It arrived on both screens before anything is edited — otherwise a
	// failure below could just be a line that never landed.
	for (const rider of [a, b]) {
		await expect(rider.getByText(SENT, { exact: true })).toBeVisible({
			timeout: 15_000,
		});
	}
	// And nobody is marked as having rewritten anything yet.
	await expect(b.getByText('edited', { exact: true })).toHaveCount(0);

	// The hover strip: the author's own line, the author's own pencil.
	const line = a.getByTestId('thread-message').filter({ hasText: SENT });
	await line.hover();
	await line.getByRole('button', { name: 'edit message' }).click();

	const editor = a.getByRole('textbox', { name: 'edit your message' });
	await expect(editor).toBeVisible();
	await editor.fill(FIXED);
	await editor.press('Enter');

	// The author's own view settles back to a rendered line, not a box.
	await expect(editor).toBeHidden();
	await expect(a.getByText(FIXED, { exact: true })).toBeVisible();

	// The point of the whole feature: it changed for the other rider too,
	// through the tick, and it says so.
	await expect(b.getByText(FIXED, { exact: true })).toBeVisible({
		timeout: 15_000,
	});
	await expect(b.getByText(SENT, { exact: true })).toHaveCount(0);
	await expect(b.getByText('edited', { exact: true })).toBeVisible();

	// Reloading reads the backlog rather than the tick — the mark has to
	// survive the trip through the database, or a rider who arrives later
	// reads a line that was quietly rewritten.
	await b.reload();
	await expect(b.getByText(FIXED, { exact: true })).toBeVisible({
		timeout: 15_000,
	});
	await expect(b.getByText('edited', { exact: true })).toBeVisible();

	// And it is the sender's own line only: B is offered no pencil on it.
	const bLine = b.getByTestId('thread-message').filter({ hasText: FIXED });
	await bLine.hover();
	await expect(bLine.getByRole('button', { name: 'edit message' })).toHaveCount(
		0,
	);
});
