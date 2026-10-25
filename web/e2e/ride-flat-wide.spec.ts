import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * A flat ride in a wide desk window (#4159): the numbers panel is its
 * content's size (TARGETS G3), so the trim stands beside the last field
 * rather than at the far end of a panel stretched across the window, the
 * empty band Jan rode beside at about 2000 × 1150.
 */
test.use({ viewport: { width: 2000, height: 1150 } });

test('the numbers panel ends at its trim in a wide window', async ({
	page,
}) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page
			.getByText('Simulated Trainer')
			.locator('..')
			.getByText(/\d+ W · \d+ rpm/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const computer = page.getByTestId('bike-computer');
	await expect(computer.getByText('rpm', { exact: true })).toBeVisible({
		timeout: 20_000,
	});

	const fit = await page.locator('[data-dock=numbers]').evaluate((dock) => {
		const box = (el: Element) => el.getBoundingClientRect();
		const panel = box(dock);
		const trim = box(dock.querySelector(':scope > div')!);
		const fields = [
			...dock.querySelectorAll('[data-testid=computer-field]'),
		].map(box);
		const surface = box(dock.closest('[data-surface=flat]')!);
		return {
			// Item 5's gaps between fields are at most 48 px; the trim's own
			// group sits no further off.
			beforeTrim: trim.left - Math.max(...fields.map((f) => f.right)),
			afterTrim: panel.right - trim.right,
			ofSurface: panel.width / surface.width,
		};
	});
	expect(fit.beforeTrim).toBeLessThanOrEqual(48);
	expect(fit.afterTrim).toBeLessThanOrEqual(24);
	expect(fit.ofSurface).toBeLessThan(0.8);

	// One picture of the workout: the graph, its blocks in words, and no
	// strip of the same workout in slot 1 (TARGETS ride-workout-flat 2, 12).
	await expect(
		page.getByTestId('ride-band').locator('svg[preserveAspectRatio=none]'),
	).toHaveCount(0);
	// The current block gives its length only: slot 1 owns its target (D17,
	// #4189). Every other block says both.
	const now = page.locator('[data-testid=block-words][data-now=true]');
	await expect(now).toContainText(/\d+ (min|s)/);
	await expect(now).not.toContainText(/\d+ W/);
	await expect(
		page.locator('[data-testid=block-words][data-now=false]').first(),
	).toContainText(/\d+ W/);
});
