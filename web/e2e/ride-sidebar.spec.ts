import type { Locator } from '@playwright/test';
import { expect, test, voicePath } from './crew';

/**
 * The sidebar on a ride (#3770, #3933). The cave covers it (TARGETS G1), so
 * every word it shows is read at SPEC's 24 px (G4, D1) and everything it
 * offers to tap is the 44 px a pedalling thumb gets (G5, ux.md); back at the
 * desk it keeps its own sizes.
 */
const RIDER = 'Ride Sidebar Rider';

/**
 * The sidebar's visible words under `px`, as "size · text". A mark that sizes
 * its own letter inline (an avatar's or a crew's initial) is not a word, and
 * a screen reader's text is not drawn.
 */
function wordsUnder(nav: Locator, px: number): Promise<string[]> {
	return nav.evaluate((root, floor) => {
		const small: string[] = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const text = n.textContent?.trim();
			const el = n.parentElement;
			if (!text || !el || el.style.fontSize) continue;
			const box = el.getBoundingClientRect();
			if (box.width <= 1 || box.height <= 1) continue;
			const size = parseFloat(getComputedStyle(el).fontSize);
			if (size < floor) small.push(`${size}px · ${text.slice(0, 40)}`);
		}
		return small;
	}, px);
}

/** The sidebar's visible links and buttons whose smaller side is under `px`. */
function targetsUnder(nav: Locator, px: number): Promise<string[]> {
	return nav.evaluate(
		(root, floor) =>
			[...root.querySelectorAll<HTMLElement>('a, button')]
				.map((el) => ({ el, box: el.getBoundingClientRect() }))
				.filter(({ box }) => box.width > 1 && box.height > 1)
				.filter(({ box }) => Math.min(box.width, box.height) < floor)
				.map(
					({ el, box }) =>
						`${Math.round(Math.min(box.width, box.height))}px · ${
							el.getAttribute('aria-label') || el.innerText
						}`,
				),
		px,
	);
}

test('the sidebar reads at 24 px on a ride, and at its desk sizes after', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const page = await riders(RIDER);
	await page.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(page, `Sidebar ${Date.now() % 100000}`);
	const nav = page.locator('nav[aria-label="crews and channels"]');

	// No session: the Training place is the free ride, on the simulator.
	await page.goto(`${voicePath(opened)}/training`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await expect(page.getByRole('button', { name: 'End ride' })).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator('.cave'), 'the lights stayed up').toHaveCount(1);
	await expect(
		nav.getByRole('link', { name: 'Home', exact: true }),
	).toBeVisible();

	expect(await wordsUnder(nav, 24), 'desk-sized words on a ride').toEqual([]);
	expect(await targetsUnder(nav, 44), 'desk-sized targets on a ride').toEqual(
		[],
	);
	await expect(
		nav.getByRole('button', { name: 'new chat' }),
		'naming a channel is typing, never mid-ride',
	).toBeHidden();

	await page.getByRole('button', { name: 'End ride' }).click();
	await expect(page.locator('.cave')).toHaveCount(0, { timeout: 15_000 });
	await expect(
		nav.getByRole('link', { name: 'Home', exact: true }),
		'the desk lost its own sizes',
	).toHaveCSS('font-size', '14px');
	await expect(nav.getByRole('button', { name: 'new chat' })).toBeVisible();
});
