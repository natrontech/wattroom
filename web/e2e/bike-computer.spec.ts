import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The bike computer (ADR-0071, #3088) on a solo ride: it opens on RIDE, ←
 * and → turn it, and so do a tap on the panel and a dot. PgUp is Harder,
 * never a page. Its numbers are the legibility budget's size on a desk.
 */
test('the bike computer turns its pages and reads from the saddle', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await signInTo(page, '/ride?w=smoke-test');
	await page.evaluate(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click({
		timeout: 15_000,
	});

	const computer = page.getByTestId('bike-computer');
	await expect(computer).toHaveAttribute('data-page', 'ride', {
		timeout: 15_000,
	});

	// docs/SPEC.md: secondary numbers 36 px, words 24 px, a unit at most half.
	const power = computer.locator('[data-field=power]');
	await expect(power).toBeVisible();
	const sizes = await power.evaluate((field) => {
		const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
		const [label, value] = field.children;
		return { label: px(label), value: px(value), unit: px(value.children[0]) };
	});
	expect(sizes.value).toBeGreaterThanOrEqual(36);
	expect(sizes.label).toBeGreaterThanOrEqual(24);
	expect(sizes.unit).toBeLessThanOrEqual(sizes.value / 2);

	await page.keyboard.press('ArrowRight');
	await expect(computer).toHaveAttribute('data-page', 'power');
	await expect(computer.locator('[data-field=power3]')).toBeVisible();
	await expect(computer.getByTestId('zone-strip')).toBeVisible();

	await page.keyboard.press('PageUp');
	await expect(computer).toHaveAttribute('data-page', 'power');

	await page.getByRole('button', { name: 'next page, RIDE' }).click();
	await expect(computer).toHaveAttribute('data-page', 'ride');

	await page.getByRole('button', { name: 'POWER page' }).click();
	await expect(computer).toHaveAttribute('data-page', 'power');
});
