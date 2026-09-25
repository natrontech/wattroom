import { expect, test, type Locator } from '@playwright/test';
import { signInTo } from './signin';

/**
 * Live bars under forced colours (#2860) — Windows high contrast, which paints
 * every background with the system's Canvas. The bars are drawn in
 * backgrounds, so they became blank space: the riding screen kept its number
 * and "on target", but not where you are against the band.
 */
test.use({ forcedColors: 'active' });

/**
 * Whether each part of a bar is drawn in something other than Canvas. By
 * channel and alpha, not by string: a translucent Canvas ("rgba(255, 255,
 * 255, 0.3)") differs from the track as text and is still invisible.
 */
async function drawn(bar: Locator, parts: Record<string, string>) {
	return bar.evaluate((track, parts) => {
		const rgba = (el: Element) =>
			(getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
		const probe = document.createElement('div');
		probe.style.cssText = 'background-color: Canvas; forced-color-adjust: none';
		document.body.append(probe);
		const canvas = rgba(probe).slice(0, 3).join();
		probe.remove();
		const out: Record<string, boolean> = {
			edge: getComputedStyle(track).borderTopWidth !== '0px',
		};
		for (const [name, selector] of Object.entries(parts)) {
			const el = track.querySelector(selector);
			const [r, g, b, a = 1] = el ? rgba(el) : [];
			out[name] = !!el && a > 0 && [r, g, b].join() !== canvas;
		}
		return out;
	}, parts);
}

test('the power gauge stays on the riding screen in forced colours', async ({
	page,
}) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await expect(
		page.getByText('Simulated Trainer').locator('..').getByText(/\d+ W/),
	).toBeVisible({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const gauge = page.getByTestId('power-gauge').first();
	// Power and a target, so the slot and its marker are drawn.
	await expect(gauge.getByTestId('gauge-target')).toBeAttached({
		timeout: 15_000,
	});
	expect(
		await drawn(gauge, {
			fill: '[data-testid=gauge-fill]',
			slot: '[data-testid=gauge-slot]',
			target: '[data-testid=gauge-target]',
		}),
	).toEqual({ edge: true, fill: true, slot: true, target: true });
});

// Every other live bar is a ProgressBar — the TV's riders, the execution
// meter, the game's — and the level bar is the one a fresh rider has.
test('a progress bar stays visible in forced colours', async ({ page }) => {
	await signInTo(page, '/u/me');
	const bar = page.getByTestId('progress').first();
	await expect(bar).toBeAttached({ timeout: 15_000 });
	expect(await drawn(bar, { fill: '[data-testid=progress-fill]' })).toEqual({
		edge: true,
		fill: true,
	});
});
