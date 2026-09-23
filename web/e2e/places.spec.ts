import { expect, test, voicePath } from './crew';
import { signInAs } from './signin';

/**
 * Every place a crew opens into, walked in one go (#502, #567; #2447 moved
 * the walk from a room's places to the crew's column).
 *
 * A throw during a place's render is invisible: SvelteKit has already moved
 * the URL, the previous place stays on screen, and nothing in CI notices.
 * Both bugs that shipped this way — an effect loop wedging the tree, and a
 * duplicate key in the medal list — would have failed here.
 *
 * The places come from the sidebar rather than a list in this file, so a new
 * one is covered the day it is added.
 */
test('every place in a crew renders, and none of them throws', async ({
	page,
	channels,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message.split('\n')[0]));

	await signInAs(page, 'Places Walker', '/home');
	const opened = await channels.open(
		page,
		`Places Walk ${Date.now() % 100000}`,
	);
	await page.goto(`/crew/${opened.crew}`);

	// The column draws the crew's pages at once and its channels when
	// /api/crews/live answers, so reading it the instant the page lands finds
	// the pages and nothing else (#960). The voice channel's row is the one
	// link whose arrival says the channels are there; `evaluateAll` has no
	// auto-waiting of its own to hold the read back.
	const nav = page.locator('nav[aria-label="rooms and places"]');
	await expect(nav.locator(`a[href="${voicePath(opened)}"]`)).toBeVisible();

	// Everything under the crew, which is every place but its Home — Home is
	// where the walk starts, and the walk is the places beyond it.
	const links = nav.locator(`a[href^="/crew/${opened.crew}/"]`);
	const places = [
		...new Set(
			await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')!)),
		),
	];
	expect(places.length).toBeGreaterThan(2);

	const main = page.locator('main').first();
	for (const href of places) {
		const before = await main.innerText();
		await page.locator(`a[href="${href}"]`).first().click();
		await expect(page).toHaveURL(new RegExp(`${href}$`));
		// The failure this catches: the URL moves and the place before it stays
		// on screen, because its render threw.
		await expect(main).not.toHaveText(before, { timeout: 10_000 });
	}

	expect(errors, `console errors while walking ${places.join(', ')}`).toEqual(
		[],
	);
});

/**
 * A face in the voice channel's people column opens that rider (#702). Opening a rider
 * there was right-click only, which `.claude/rules/ux.md` forbids — the
 * primary action stays on click, and nothing lives ONLY in a menu. One rider
 * is enough: the column always lists you, so your own face is the target.
 */
test('a face in the people column opens that rider’s page', async ({
	page,
	channels,
}) => {
	await signInAs(page, 'Face Clicker', '/home');
	await channels.open(page, `Face Click ${Date.now() % 100000}`);

	// The column lists the people, not the nav: a rider link inside a list row.
	const face = page.locator('li a[href^="/u/"]').first();
	await expect(face).toBeVisible();
	const href = await face.getAttribute('href');

	// A thumb finds this mid-ride, so the row's whole height is the target.
	expect((await face.boundingBox())!.height).toBeGreaterThanOrEqual(44);

	await face.click();
	await expect(page).toHaveURL(new RegExp(`${href}$`));
	await expect(page.locator('h1')).toBeVisible();
});
