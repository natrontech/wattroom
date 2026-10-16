import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

test('a saved road step rides without a power target and finishes', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Road Step Verify', '/workouts');
	const name = `Road step ${Date.now()}`;
	const response = await page.request.post('/api/workouts', {
		data: { workout: { name, steps: [{ type: 'road', seconds: 65 }] } },
	});
	expect(response.ok()).toBe(true);
	const { id } = await response.json();
	try {
		await page.goto(`/ride?w=${id}`);
		await expect(
			page.getByRole('heading', { name, exact: true }),
		).toBeVisible();
		await page.getByRole('button', { name: 'Ride simulated' }).click();
		await expect(
			page
				.getByText('Simulated Trainer')
				.locator('..')
				.getByText(/\d+ W · \d+ rpm/),
		).toBeVisible({ timeout: 15000 });
		await page.getByRole('button', { name: 'Start the ride' }).click();
		await expect(
			page.getByText('SIM · you feel 0.0 %', { exact: true }),
		).toBeVisible();
		await expect(page.getByTestId('download-fit')).toBeVisible({
			timeout: 120000,
		});
		await expect(page.getByRole('link', { name: 'See your ride' })).toBeVisible(
			{ timeout: 15000 },
		);
	} finally {
		await page.request.delete(`/api/workouts/${id}`);
	}
});
