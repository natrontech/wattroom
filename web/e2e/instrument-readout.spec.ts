import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The big number stays inside its own box (#2888, L8-11). The box was a fixed
 * 112 px holding about 118 px — the numeral, "watts" and the zone line — and,
 * anchored at its foot, spilled upward into whatever sat above: on a phone,
 * the "watching …" label that says whose number it is.
 */
test('the readout does not spill out of its box', async ({ page }) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page.getByText('Simulated Trainer').locator('..').getByText(/\d+ W/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const box = page.getByTestId('instrument-readout').first();
	// Pedalling, so all three lines are there: number, "watts", the zone.
	await expect(box.getByText(/^z\d/i)).toBeVisible({ timeout: 15_000 });
	const spill = await box.evaluate((el) => {
		const top = el.getBoundingClientRect().top;
		const highest = Math.min(
			...[...el.querySelectorAll('*')].map(
				(c) => c.getBoundingClientRect().top,
			),
		);
		return top - highest;
	});
	expect(spill, 'px of the readout above its own box').toBeLessThanOrEqual(0);
});
