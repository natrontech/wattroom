import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * Nothing glides for a rider who asked the OS for reduced motion (#2888,
 * L8-13; ADR-0005). The drawer slid in, the right-hand sheet flew in and the
 * big number crossed the gauge every second, each with its own transition and
 * none of them asking.
 */
const transitions = () =>
	[...document.querySelectorAll('*')]
		.map((el) => getComputedStyle(el).transitionDuration)
		.filter((d) => d.split(',').some((part) => parseFloat(part) > 0)).length;

test.describe('reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });
	test('stills every transition', async ({ page }) => {
		await signInTo(page, '/home');
		await expect(page.getByTestId('page-body')).toBeVisible();
		expect(await page.evaluate(transitions)).toBe(0);
	});
});

test('without it, the page still moves', async ({ page }) => {
	await signInTo(page, '/home');
	await expect(page.getByTestId('page-body')).toBeVisible();
	expect(await page.evaluate(transitions)).toBeGreaterThan(0);
});
