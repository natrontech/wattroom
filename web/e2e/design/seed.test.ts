// The design shots' fixtures are found again by name (#3666): a second run
// reuses the first's. The shelf's rows carry the name under `workout`, so a
// lookup by a top-level name never found one and saved it again (#4259).
import type { Page } from '@playwright/test';
import { expect, it } from 'vitest';
import { bigWatts } from './seed';

/** The API's shelf, behind the page.evaluate the seed calls it through. */
function fakeShelf() {
	const workouts: { id: string; workout: { name: string } }[] = [];
	let posts = 0;
	const page = {
		evaluate: async (
			_fn: unknown,
			[method, , json]: readonly [string, string, unknown],
		) => {
			if (method === 'GET') return { status: 200, body: { workouts } };
			posts++;
			const { workout } = json as { workout: { name: string } };
			const id = `w${posts}`;
			workouts.push({ id, workout });
			return { status: 201, body: { id } };
		},
	} as unknown as Page;
	return { page, posts: () => posts };
}

it('saves the four-digit workout once, and finds it the next time', async () => {
	const shelf = fakeShelf();
	const first = await bigWatts(shelf.page);
	const again = await bigWatts(shelf.page);
	expect(again).toBe(first);
	expect(shelf.posts()).toBe(1);
});
