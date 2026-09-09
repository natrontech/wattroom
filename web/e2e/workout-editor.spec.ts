import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The editor had no flow of its own (#1713): undo and redo, the leave guard
 * (#1711), save → the shelf, and `?w=` hydrating a saved workout back into
 * the sheet — the path that once overwrote a saved workout with a fresh one
 * (audit 2026-09-09). One walk, so a regression in any of them shows here
 * rather than on a rider's Tuesday.
 */
test('a workout is shaped, guarded, saved, and comes back through ?w=', async ({
	page,
}) => {
	await signInAs(page, 'Editor Rider', '/workouts/edit');
	const name = `Editor Flow ${Date.now() % 100000}`;
	const blocks = page.getByText(/· \d+ blocks/);

	// A fresh sheet: one steady block, nothing to undo.
	await expect(page.getByLabel('Workout name')).toHaveValue('New workout');
	await expect(blocks).toHaveText(/1 blocks/);
	await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

	await page.getByLabel('Workout name').fill(name);
	await page.getByLabel(/^duration/).fill('5:00');
	await page.getByLabel(/^duration/).press('Tab');
	await page.getByRole('button', { name: 'Duplicate' }).click();
	await expect(blocks).toHaveText(/10:00 · 2 blocks/);

	// ⌘Z has a face (#1392): the two verbs the whole sheet answers to.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(blocks).toHaveText(/1 blocks/);
	await page.getByRole('button', { name: 'Redo' }).click();
	await expect(blocks).toHaveText(/2 blocks/);

	// Twenty minutes of shaping must not leave without a word (#1711).
	await page.getByRole('link', { name: 'Cancel' }).click();
	const guard = page.getByRole('dialog', { name: 'Leave without saving?' });
	await expect(guard).toBeVisible();
	await guard.getByRole('button', { name: 'Stay' }).click();
	await expect(page).toHaveURL(/\/workouts\/edit$/);
	await expect(page.getByLabel('Workout name')).toHaveValue(name);

	// Save lands it on the shelf, with the sheet's way to ride it.
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/workouts$/);
	const card = page.getByRole('listitem').filter({ hasText: name });
	await expect(card).toBeVisible();
	const editHref = await card
		.getByRole('link', { name: 'Edit', exact: true })
		.getAttribute('href');
	const id = editHref?.split('?w=')[1];
	expect(id, 'the shelf card carries no id to edit by').toBeTruthy();

	// ?w= hydrates the saved workout, and a save from there updates it in
	// place rather than adding a second one.
	await page.goto(`/workouts/edit?w=${id}`);
	await expect(page.getByLabel('Workout name')).toHaveValue(name);
	await expect(blocks).toHaveText(/10:00 · 2 blocks/);
	await page.getByLabel('Workout name').fill(`${name} v2`);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/workouts$/);
	await expect(
		page.getByRole('listitem').filter({ hasText: `${name} v2` }),
	).toHaveCount(1);
	await expect(
		page.getByRole('listitem').filter({ hasText: name }),
	).toHaveCount(1);

	// The rider's shelf is theirs across runs: take the workout back.
	const status = await page.evaluate(
		(workoutId) =>
			fetch(`/api/workouts/${workoutId}`, { method: 'DELETE' }).then(
				(res) => res.status,
			),
		id,
	);
	expect(status, `workout ${id} survived the test`).toBe(204);
});
