import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * "Where am I?" has exactly one answer, on every page the column parents
 * (ADR-0020, rule 1 — a page with no lit row is a bug, not a page).
 *
 * A column that lights NOTHING is a silent failure: nothing throws, nothing
 * logs, the page renders, and only a rider notices. `/rooms/directory` and
 * `/messages` both shipped that way (#1863) with unit tests green either
 * side of them, because the decision is one function and the wiring is one
 * attribute. This walks the real DOM instead, and counts.
 *
 * Counting is the point rather than only naming the row: it catches the
 * opposite mistake in the same assertion — a fix that lights the right row
 * and leaves the last one lit as well, which reads as two places at once.
 */
test('every destination the sidebar parents lights exactly one row', async ({
	page,
}) => {
	await signInAs(page, 'Nav Reader', '/home');

	const nav = page.locator('nav[aria-label="rooms and places"]');
	await expect(nav).toBeVisible();
	const current = nav.locator('[aria-current]');

	// Anchored, but tolerant of the whitespace a row's own markup leaves
	// around its label — `toHaveText` matches a regex against the text as it
	// stands, so `/^Home$/` misses the " Home " the icon and the newlines
	// leave behind. Anchoring is what makes this say WHICH row rather than
	// merely that the word appears somewhere in the column.
	const row = (label: string) => new RegExp(`^\\s*${label}\\s*$`, 'i');

	// Home last as well as first: the walk has to prove the row it lit on the
	// way out goes dark again, not merely that each page lights something.
	const walk: { path: string; label: RegExp }[] = [
		{ path: '/home', label: row('Home') },
		{ path: '/workouts', label: row('Workouts') },
		// The directory is the other half of Home's open/join card, so Home
		// stays lit under it — the way Workouts stays lit under a ride.
		{ path: '/rooms/directory', label: row('Home') },
		// No thread row belongs to the messages index, so the section heading
		// is the row that answers for it.
		{ path: '/messages', label: row('direct messages') },
		{ path: '/history', label: row('Rides') },
		{ path: '/home', label: row('Home') },
	];

	for (const { path, label } of walk) {
		await page.goto(path);
		await expect(page).toHaveURL(new RegExp(`${path}$`));
		// One, never two: the row for the page before this one has to have
		// let go of `aria-current`.
		await expect(current).toHaveCount(1);
		await expect(current).toHaveText(label);
	}
});

/**
 * The same rule where the thread's own row is not on screen (#1863). A rider
 * reaches a conversation from a notification, a friend's page or a pasted
 * link, and the row that would say which one has three ways to be absent: the
 * fold is shut, the list has not landed yet, or the conversation is new
 * enough to have no entry in it. The heading answers in all three, which is
 * why `dmsCurrent` asks whether the row is on screen rather than about the
 * fold.
 *
 * A thread of this rider's own would need a second account and a sent
 * message; the absent-row case needs neither, and it is the case that went
 * dark.
 */
test('a conversation with no row of its own still lights one', async ({
	page,
}) => {
	await signInAs(page, 'Fold Reader', '/messages');

	const nav = page.locator('nav[aria-label="rooms and places"]');
	const heading = nav.getByRole('button', { name: /direct messages/i });
	await expect(heading).toBeVisible();
	await expect(heading).toHaveAttribute('aria-current', 'page');

	await page.goto('/messages/dm/nobody');
	await expect(nav.locator('[aria-current]')).toHaveCount(1);
	await expect(heading).toHaveAttribute('aria-current', 'page');

	// And with the list shut, which is the state a rider who folded it once
	// keeps for good — it is remembered per device, so the fold is read
	// rather than assumed before it is toggled.
	if ((await heading.getAttribute('aria-expanded')) === 'true')
		await heading.click();
	await expect(heading).toHaveAttribute('aria-expanded', 'false');
	await expect(nav.locator('[aria-current]')).toHaveCount(1);
	await expect(heading).toHaveAttribute('aria-current', 'page');
});
