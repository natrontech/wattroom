import { expect, test, type Page } from '@playwright/test';
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

/**
 * Every running animation that moves something (#3208): CSS transitions,
 * `@keyframes` and the Web Animations a Svelte transition or `animate:` runs,
 * which the count above never saw. Fading is allowed; moving is not.
 */
const moving = () =>
	document
		.getAnimations()
		.filter((animation) =>
			(animation.effect as KeyframeEffect | null)
				?.getKeyframes()
				.some((frame) =>
					[
						'transform',
						'translate',
						'scale',
						'rotate',
						'left',
						'top',
						'width',
						'height',
					].some((property) => property in frame),
				),
		)
		.map((animation) => {
			const target = (animation.effect as KeyframeEffect).target;
			const name =
				'animationName' in animation
					? animation.animationName
					: 'transitionProperty' in animation
						? animation.transitionProperty
						: animation.constructor.name;
			return `${name} on ${target?.nodeName.toLowerCase()}.${String(target?.getAttribute?.('class') ?? '').slice(0, 60)}`;
		});

/** What moved at any point over `ms`, sampled the way a rider would see it. */
async function movedOver(page: Page, ms: number): Promise<string[]> {
	const seen = new Set<string>();
	const end = Date.now() + ms;
	while (Date.now() < end) {
		for (const found of await page.evaluate(moving)) seen.add(found);
		await page.waitForTimeout(200);
	}
	return [...seen];
}

test.describe('reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });
	test('stills every transition', async ({ page }) => {
		await signInTo(page, '/home');
		await expect(page.getByTestId('page-body')).toBeVisible();
		expect(await page.evaluate(transitions)).toBe(0);
		expect(await movedOver(page, 1_500)).toEqual([]);
	});

	test('moves nothing through a count-in and a sprint', async ({ page }) => {
		await signInTo(page, '/ride?w=sprint-smoke');
		await page.getByRole('button', { name: 'Ride simulated' }).click();
		await expect(
			page
				.getByText('Simulated Trainer')
				.locator('..')
				.getByText(/\d+ W · \d+ rpm/),
		).toBeVisible({ timeout: 15_000 });
		await page.getByRole('button', { name: 'Start the ride' }).click();
		// The count-in (3 s), five seconds of riding with the sprint armed over
		// them, then its window: every surface the riding screen shows.
		const moved = await movedOver(page, 12_000);
		await expect(page.getByText('all out').first()).toBeVisible();
		expect([...moved, ...(await movedOver(page, 4_000))]).toEqual([]);
	});
});

test('without it, the page still moves', async ({ page }) => {
	await signInTo(page, '/home');
	await expect(page.getByTestId('page-body')).toBeVisible();
	expect(await page.evaluate(transitions)).toBeGreaterThan(0);
});
