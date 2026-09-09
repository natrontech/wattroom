import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

/**
 * The riding screen in a narrow window (#1634, ADR-0046).
 *
 * Not in `phone-width.spec.ts`, and the reason is the reason that spec has its
 * own project: a phone is a spectator (`device.svelte.ts` — narrow, coarse and
 * no Bluetooth), so it cannot pair a trainer and never reaches this screen at
 * all. What does is a narrow window on a machine that can: a laptop beside the
 * bike, a tablet, a dragged-in browser. Chromium's project, 375 px wide.
 *
 * `phone-width.spec.ts` lists `/ride`, but only ever visits it BEFORE a ride
 * starts — a different screen, with none of the controls that overflowed.
 */
test.use({ viewport: { width: 375, height: 812 } });

test('the riding screen does not scroll sideways at 375px', async ({
	page,
}) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	const trainerCard = page.getByText('Simulated Trainer').locator('..');
	await expect(trainerCard.getByText(/\d+ W · \d+ rpm/)).toBeVisible({
		timeout: 15_000,
	});
	await page.getByRole('button', { name: 'Start the ride' }).click();

	// The header only takes its full width once a block is drawn in it.
	await expect(page.getByTestId('ride-clock')).toBeVisible({ timeout: 15_000 });

	// The shell's overflow-hidden columns absorb the excess, so the document
	// measures 375 either way — the page body is what has to be measured.
	const body = page.getByTestId('page-body');
	const excess = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(excess, 'the riding screen is wider than the window').toBe(0);

	// And the last control is inside it, not merely un-scrolled-to: the ⚑ sat
	// 39 px past the right edge with nothing to scroll, so it could not be
	// tapped at all.
	const flag = page.getByRole('button', { name: 'Flag a problem' });
	const box = await flag.boundingBox();
	expect(box, 'the ⚑ has a box').not.toBeNull();
	expect(box!.x + box!.width, 'the ⚑ is on screen').toBeLessThanOrEqual(375);
});
