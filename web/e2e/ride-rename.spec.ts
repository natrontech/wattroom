import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * A finished ride gets a name of its own (#4209): Rename on its page opens
 * the box, the header and the Rides list read the new name, Against your best
 * still says what was ridden, and Undo gives the old name back.
 */
test('a rider renames a finished ride, and undoes it', async ({ page }) => {
	await signInAs(page, 'Ride Renamer', '/history');
	const id = await page.evaluate(async () => {
		const res = await fetch('/api/rides', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Sweet Spot 3x12',
				workoutJson: JSON.stringify({
					name: 'Sweet Spot 3x12',
					author: 'e2e',
					steps: [{ type: 'steady', seconds: 120, target: 0.88 }],
				}),
				startedAt: new Date(Date.now() - 3_600_000).toISOString(),
				samples: Array.from({ length: 120 }, () => ({ watts: 240 })),
			}),
		});
		return ((await res.json()) as { id: string }).id;
	});

	await page.goto(`/history/${id}`);
	const heading = page.getByRole('heading', { level: 1 });
	await expect(heading).toHaveText('Sweet Spot 3x12');

	await page
		.getByTestId('recap-actions')
		.getByRole('button', { name: 'Rename' })
		.click();
	const box = page.getByLabel('your name for it');
	// Opening a text-first task focuses its input (ux.md).
	await expect(box).toBeFocused();
	await expect(box).toHaveAttribute('placeholder', 'Sweet Spot 3x12');
	await box.fill('Tuesday with heavy legs');
	await page
		.getByTestId('ride-name')
		.getByRole('button', { name: 'Rename' })
		.click();

	await expect(heading).toHaveText('Tuesday with heavy legs');
	await expect(page.getByTestId('ride-name')).toHaveCount(0);
	await expect(
		page.getByText('First time you have ridden Sweet Spot 3x12'),
	).toBeVisible();

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(heading).toHaveText('Sweet Spot 3x12');

	// Named again, and the list reads it.
	await page
		.getByTestId('recap-actions')
		.getByRole('button', { name: 'Rename' })
		.click();
	await page.getByLabel('your name for it').fill('Tuesday with heavy legs');
	await page.keyboard.press('Enter');
	await expect(heading).toHaveText('Tuesday with heavy legs');
	await page.goto('/history');
	await expect(page.getByText('Tuesday with heavy legs').first()).toBeVisible();

	await page.evaluate(
		(id) => fetch(`/api/rides/${id}`, { method: 'DELETE' }),
		id,
	);
});
