import { expect, test } from './crew';

/**
 * A picker inside a dialog shows its whole list (#2719). The dialog's panel
 * scrolls, and a `Select` drew its list inside that scroll: opening "Clear
 * after" in the status editor showed two of its six options and cut the rest
 * off at the dialog's edge.
 */

/** This spec's own rider (#2133). */
const RIDER = 'Select Dialog Rider';

test('every option of a picker in a dialog can be reached', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	await page.evaluate(() => fetch('/api/me/status', { method: 'DELETE' }));
	await page.goto('/u/me');
	await page.getByRole('button', { name: 'Set a status' }).click();
	const dialog = page.getByRole('dialog', { name: 'Set a status' });
	await dialog.getByLabel('Status', { exact: true }).fill('Testing pickers');
	await dialog.getByRole('combobox', { name: /Clear after/ }).click();

	const options = page.getByRole('option');
	await expect(options).toHaveCount(6);
	// Visible is not reachable: a clipped option still has a box. What a tap
	// at its centre would land on is the question.
	for (const option of await options.all()) {
		const reachable = await option.evaluate((el) => {
			const box = el.getBoundingClientRect();
			const hit = document.elementFromPoint(
				box.left + box.width / 2,
				box.top + box.height / 2,
			);
			return !!hit && el.contains(hit);
		});
		expect(reachable, `${await option.textContent()} is cut off`).toBe(true);
	}
});
