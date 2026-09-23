import { expect, test } from './crew';

/**
 * The crew's own header, at 375 px, for the rider the main-crew control
 * renders for: someone in two or more crews (#2144).
 *
 * Unwrapped, the mark, "Make it my main crew" and "Settings" left about thirty
 * pixels for the crew's name, so the h1 was an ellipsis (#2175). The
 * phone-width sweep could not see it: it seeds one crew, so the control never
 * drew, and it measures sideways overflow rather than a truncated line.
 */

/** This spec's own riders — nobody else's (#2133). */
const A = 'Crew Header Host';
const B = 'Crew Header Other';
const PHONE = { width: 375, height: 812 };
// An ordinary crew name — long enough that thirty pixels cannot hold it,
// short enough that a phone's line can. A name that could not fit on any
// layout would only prove that `truncate` works.
const NAME = 'Thursday Crew';

test("a crew's name is not squeezed out of its own header on a phone", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	await a.setViewportSize(PHONE);
	const mine = await channels.open(a, `Crew Header ${Date.now() % 100000}`);

	// A second crew, so the main-crew control has a choice to offer.
	const b = await riders(B);
	const theirs = await channels.open(b, `Other Crew ${Date.now() % 100000}`);
	await channels.enter(a, theirs);

	const crewId = mine.crew;
	// A name long enough to need the space it is owed.
	const named = await a.evaluate(
		([id, name]) =>
			fetch(`/api/crews/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name }),
			}).then((res) => res.status),
		[crewId, NAME],
	);
	expect(named, 'renaming the crew').toBeLessThan(300);

	await a.goto(`/crew/${crewId}`);
	const title = a.getByRole('heading', { level: 1 });
	await expect(title).toHaveText(NAME, { timeout: 15_000 });
	// The control is on screen — otherwise this measures the easy case.
	await expect(
		a.getByRole('button', { name: 'Make it my main crew' }),
	).toBeVisible();

	// Not truncated, and holding the row rather than the sliver two buttons
	// left it: the ellipsis is what a rider saw instead of the name.
	const { cut, width } = await title.evaluate((el) => ({
		cut: el.scrollWidth - el.clientWidth,
		width: el.clientWidth,
	}));
	expect(cut, `the crew's name is cut by ${cut}px in its own header`).toBe(0);
	expect(
		width,
		`the crew's name is given ${width}px of a 375px phone`,
	).toBeGreaterThan(200);
});
