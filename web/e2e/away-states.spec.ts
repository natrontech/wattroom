import { expect, test, voicePath } from './room';

/**
 * Away says which kind of away (#706, the split button).
 *
 * The unit tests own the vocabulary and the hub's verbs; what only a browser
 * can show is that the three of them meet — a press in one rider's sidebar, a
 * glyph on the tile a SECOND rider's room draws, and a sentence in that
 * rider's log. Two riders because the timeline drops your own presence lines
 * (#984): the rider who stepped out already knows, and telling them is how a
 * log fills with a rider's own comings and goings.
 */
const A = 'Away States Host';
const B = 'Away States Guest';

test('a rider picks a state, and the room is told which', async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	// A desk-sized window: the you-panel's Away row and the room's tiles are
	// only on screen together from `xl`.
	await a.setViewportSize({ width: 1440, height: 900 });
	const name = `Away States ${Date.now() % 100000}`;
	const room = await rooms.open(a, name);

	const b = await riders(B);
	await b.setViewportSize({ width: 1440, height: 900 });
	await rooms.enter(b, room);
	await a.goto(voicePath(room));
	// B waits in the voice channel, whose page draws its events beside the
	// deck (ADR-0022 as amended by ADR-0058), BEFORE A presses anything:
	// they are ephemeral and a reload shows none of them, so a rider who
	// arrives afterwards sees nothing.
	await b.goto(voicePath(room));

	// The face before anything is chosen: one tap always means the plain
	// thing, which is the whole reason the arrow exists.
	const face = a.getByRole('button', { name: 'Away', exact: true });
	await expect(face).toBeVisible();

	await a.getByRole('button', { name: 'Choose a state' }).click();
	const menu = a.getByRole('menu');
	await expect(
		menu.getByRole('menuitem', { name: 'Nature break' }),
	).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'Showering' })).toBeVisible();
	await menu.getByRole('menuitem', { name: 'Refuelling' }).click();

	// A's own button has become the way back, and the arrow is gone with it:
	// there is nothing to choose about being back.
	await expect(a.getByRole('button', { name: "I'm back" })).toBeVisible();
	await expect(a.getByRole('button', { name: 'Choose a state' })).toHaveCount(
		0,
	);

	// What the room was told — the hub's own line, through B's socket.
	await expect(b.getByText(`${A} is refuelling`)).toBeVisible({
		timeout: 15_000,
	});
	// And A wears that state's mark in B's channel, not the plain cup — on
	// A's own tile. The voice channel's page draws A twice (the tile and the
	// people column), where the Chat place this used to watch drew once.
	const mark = b
		.getByTestId('rider-tile')
		.filter({ hasText: A })
		.getByRole('img', { name: 'Refuelling' });
	await expect(mark).toBeVisible();

	await a.getByRole('button', { name: "I'm back" }).click();
	await expect(b.getByText(`${A} is back`)).toBeVisible({ timeout: 15_000 });
	// Gone everywhere B could see it, not just from the tile.
	await expect(b.getByRole('img', { name: 'Refuelling' })).toHaveCount(0);
	await expect(face).toBeVisible();
});
