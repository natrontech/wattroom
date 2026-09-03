import { expect, test } from './room';
import { signInAs } from './signin';

/**
 * Every place a room opens into, walked in one go (#502, #567).
 *
 * A throw during a place's render is invisible: SvelteKit has already moved
 * the URL, the previous place stays on screen, and nothing in CI notices.
 * Both bugs that shipped this way — an effect loop wedging the tree, and a
 * duplicate key in the medal list — would have failed here.
 *
 * The places come from the sidebar rather than a list in this file, so a new
 * one is covered the day it is added.
 */
test('every place in a room renders, and none of them throws', async ({
	page,
	rooms,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message.split('\n')[0]));

	await signInAs(page, 'Places Walker', '/rooms');
	const { slug } = await rooms.open(page, `Places Walk ${Date.now() % 100000}`);

	const links = page.locator(`a[href^="/r/${slug}"]`);
	const hrefs = [
		...new Set(
			await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')!)),
		),
	];
	// The lounge is where creation landed; the walk is the places beyond it.
	const places = hrefs.filter((href) => href !== `/r/${slug}`);
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
