import { expect, test } from './room';

/**
 * A crew row says where its room stands, and its button says what pressing
 * it does (#2177, ux.md). They used to be one string — the step the press
 * would move the room TO — so an open room's only descriptor read "Only its
 * members", which is the truth upside down.
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Crew Reach Host';

test("a crew's room row says where it stands, and its button says what it does", async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const name = `Crew Reach ${Date.now() % 100000}`;
	const room = await rooms.open(a, name);
	const crewId = await a.evaluate(
		(slug) =>
			fetch(`/api/rooms/${slug}`)
				.then((res) => res.json())
				.then((r) => String(r.crew?.id ?? '')),
		room.slug,
	);
	expect(crewId).not.toBe('');

	// A room starts open to the crew (#1201).
	await a.goto(`/crew/${crewId}`);
	// Scoped to the page: the sidebar lists the same room by the same name.
	const row = a
		.getByTestId('page-body')
		.getByRole('listitem')
		.filter({ hasText: name });
	await expect(row).toContainText('Open to the crew');
	const act = row.getByRole('button');
	await expect(act).toHaveText('Shut to its members');

	// Press it, and both strings are the other way round — never both the
	// same step, which is what made the row lie.
	await act.click();
	await expect(row).toContainText('private');
	await expect(act).toHaveText('Open to the crew');
});
