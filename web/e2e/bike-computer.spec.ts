import { expect, test } from '@playwright/test';
import { openAWorkoutOnARoad } from './route';
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

	// docs/SPEC.md's desk row: secondary numbers 24 px, labels 11 px, a unit at most half.
	// RIDE leaves the watts to the instrument above it (D17); cadence carries a unit.
	const cadence = computer.locator('[data-field=cadence]');
	await expect(cadence).toBeVisible();
	const sizes = await cadence.evaluate((field) => {
		const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
		const [label, value] = field.children;
		return { label: px(label), value: px(value), unit: px(value.children[0]) };
	});
	expect(sizes.value).toBeGreaterThanOrEqual(24);
	expect(sizes.label).toBeGreaterThanOrEqual(11);
	expect(sizes.unit).toBeLessThanOrEqual(sizes.value / 2);

	await page.keyboard.press('ArrowRight');
	await expect(computer).toHaveAttribute('data-page', 'power');
	// The head above shows the 3 s power, so POWER opens on the 10 s (D17).
	await expect(computer.locator('[data-field=power10]')).toBeVisible();
	await expect(computer.locator('[data-field=power3]')).toHaveCount(0);
	await expect(computer.getByTestId('zone-strip')).toBeVisible();

	await page.keyboard.press('PageUp');
	await expect(computer).toHaveAttribute('data-page', 'power');

	await page.getByRole('button', { name: 'next page, RIDE' }).click();
	await expect(computer).toHaveAttribute('data-page', 'ride');

	await page.getByRole('button', { name: 'next page, POWER' }).click();
	await expect(computer).toHaveAttribute('data-page', 'power');
});

/**
 * TARGETS ride-road-world 9 (#3898): W/kg sits beside the 3 s power up to
 * 999 W and wraps under it at four digits, which no row beside can hold at
 * SPEC's desk size. The watts are drawn figure by figure, so the test redraws them.
 */
test('W/kg wraps under a four-digit power @world', async ({ page }) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		);
		// The docked head lives in the world (design/shoot.ts).
		localStorage.setItem('wattroom.world.mode.v1', 'full');
	});
	await signInTo(page, '/ride');
	await page.getByRole('button', { name: 'Ride simulated' }).waitFor();
	await openAWorkoutOnARoad(page);
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const head = page.getByTestId('computer-head');
	await expect(head).toBeVisible({ timeout: 15_000 });

	const rows = (digits: string) =>
		head.evaluate((el, d) => {
			const power = el.querySelector('[data-testid=head-power]')!;
			const figures = power.querySelectorAll('[data-figure]');
			figures.forEach((f, i) => {
				if (i < d.length) f.setAttribute('data-figure', d[i]);
			});
			while (power.querySelectorAll('[data-figure]').length < d.length) {
				const last = power.querySelectorAll('[data-figure]');
				last[last.length - 1].after(last[last.length - 1].cloneNode(true));
			}
			power
				.querySelectorAll('[data-figure]')
				.forEach((f, i) => f.setAttribute('data-figure', d[i]));
			const wkg = el.querySelector('[data-field=wkg]')!.getBoundingClientRect();
			const p = power.getBoundingClientRect();
			return { besideRow: wkg.top < p.bottom, width: el.clientWidth };
		}, digits);

	const three = await rows('888');
	expect(three.besideRow).toBe(true);
	const four = await rows('1250');
	expect(four.besideRow).toBe(false);
});
