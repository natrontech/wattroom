import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * A workout card's ghost actions keep their labels on the card's text edges
 * (#3802, TARGETS G7). The button's own padding sat between its box and its
 * word, so Edit and Save a copy started 12 px right of the title, and Delete
 * ended 12 px left of the duration.
 */
const EDGE_TOLERANCE = 2;

/** Where the words themselves are, not the padded box around them. */
const wordsBox = (el: Locator) =>
	el.evaluate((node) => {
		const range = document.createRange();
		range.selectNodeContents(node);
		const { left, right } = range.getBoundingClientRect();
		return { left, right };
	});

async function edges(page: Page, card: Locator) {
	return {
		title: await wordsBox(card.locator('a.font-display')),
		duration: await wordsBox(card.locator('span.num').first()),
	};
}

for (const [label, viewport] of [
	['desk', { width: 1280, height: 900 }],
	['phone', { width: 375, height: 812 }],
] as const) {
	test(`${label}: a workout card's ghost actions sit on its text edges`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await page.addInitScript(() =>
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			),
		);
		// Unique per run: this rider keeps their workouts between runs (#2083).
		const name = `Edge ${Date.now().toString(36)}`;
		await signInAs(page, 'Card Edge', '/workouts');
		const id = await page.evaluate(async (workoutName) => {
			const res = await fetch('/api/workouts', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workout: {
						name: workoutName,
						steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
					},
				}),
			});
			return ((await res.json()) as { id: string }).id;
		}, name);
		try {
			await page.goto('/workouts');

			const curated = page
				.getByRole('listitem')
				.filter({ has: page.getByRole('link', { name: 'Save a copy' }) })
				.first();
			await expect(curated).toBeVisible({ timeout: 15_000 });
			const copy = await wordsBox(
				curated.getByRole('link', { name: 'Save a copy' }),
			);
			const curatedEdges = await edges(page, curated);
			expect(Math.abs(copy.left - curatedEdges.title.left)).toBeLessThan(
				EDGE_TOLERANCE,
			);

			const own = page
				.getByRole('listitem')
				.filter({ has: page.getByRole('link', { name }) });
			await expect(own).toBeVisible({ timeout: 15_000 });
			const edit = await wordsBox(own.getByRole('link', { name: 'Edit' }));
			const del = await wordsBox(own.getByRole('button', { name: 'Delete' }));
			const ownEdges = await edges(page, own);
			expect(Math.abs(edit.left - ownEdges.title.left)).toBeLessThan(
				EDGE_TOLERANCE,
			);
			expect(Math.abs(del.right - ownEdges.duration.right)).toBeLessThan(
				EDGE_TOLERANCE,
			);
		} finally {
			await page.evaluate(
				(workoutId) =>
					fetch(`/api/workouts/${workoutId}`, { method: 'DELETE' }),
				id,
			);
		}
	});
}
