import { expect, test } from './room';

/**
 * Nothing lives only in a menu (ux.md). The crew's people list offered the
 * hand-over and the ban behind a right-click alone — a long-press on touch,
 * with a tooltip no phone shows — while the same page tells the owner to
 * "hand it to someone in the people list first" (#2154).
 *
 * The room's Members place grew a visible "…" for this in #1372; this is the
 * roster that did not.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Crew People Host';
const B = 'Crew People Member';

test("the crew's people rows offer the owner's actions without a right-click", async ({
	riders,
	rooms,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const room = await rooms.open(a, `Crew People ${Date.now() % 100000}`);
	const b = await riders(B);
	await rooms.enter(b, room);

	const crewId = await a.evaluate(
		(slug) =>
			fetch(`/api/rooms/${slug}`)
				.then((res) => res.json())
				.then((r) => String(r.crew?.id ?? '')),
		room.slug,
	);
	await a.goto(`/crew/${crewId}/members`);

	const row = a
		.getByTestId('page-body')
		.getByRole('listitem')
		.filter({ hasText: B });
	await expect(row).toBeVisible({ timeout: 15_000 });

	// A plain click, the way a phone can: no right-click, no long-press.
	await row.getByRole('button', { name: `more actions for ${B}` }).click();
	const menu = a.getByRole('menu');
	await expect(
		menu.getByRole('menuitem', { name: /Hand the crew to/ }),
	).toBeVisible();
	await expect(
		menu.getByRole('menuitem', { name: 'Ban from the crew' }),
	).toBeVisible();
});
