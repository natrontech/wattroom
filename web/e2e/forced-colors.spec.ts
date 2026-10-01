import { expect, test, type Locator } from '@playwright/test';
import { signInAs, signInTo } from './signin';

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

test("the bike computer's page dots stay drawn in forced colours", async ({
	page,
}) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	await page.getByRole('button', { name: 'Start the ride' }).click({
		timeout: 15_000,
	});
	const current = page.getByRole('button', { name: 'RIDE page' });
	await expect(current).toHaveAttribute('aria-current', 'page', {
		timeout: 15_000,
	});
	// Each dot keeps its ring, and the page you are on keeps its fill: a
	// background alone is painted over with Canvas (#3088).
	const mark = (dot: Locator) =>
		dot.evaluate((button) => {
			const dotMark = button.querySelector('span')!;
			const probe = document.createElement('div');
			probe.style.cssText =
				'background-color: Canvas; forced-color-adjust: none';
			document.body.append(probe);
			const canvas = getComputedStyle(probe).backgroundColor;
			probe.remove();
			const style = getComputedStyle(dotMark);
			return {
				ring: style.borderTopWidth !== '0px',
				fill:
					style.backgroundColor !== canvas &&
					!/rgba\(.*,\s*0\)$/.test(style.backgroundColor),
			};
		});
	expect(await mark(current)).toEqual({ ring: true, fill: true });
	expect(
		(await mark(page.getByRole('button', { name: 'POWER page' }))).ring,
	).toBe(true);
});

// The HUD's strip of the road ahead (#3092) is drawn in SVG fills, which
// forced colours leave as the author's faint neon mix; each bar has to take
// the system's GrayText instead, as the Skyline's do.
test("the HUD's road strip stays drawn in forced colours", async ({
	context,
	page,
}) => {
	// /hud signed out says to sign in on the main window, so its door is ?as=.
	await signInAs(page, 'Forced HUD', '/hud');
	const rider = await context.newPage();
	await rider.goto('/home');
	await rider.evaluate(() => {
		new BroadcastChannel('wattroom.hud').postMessage({
			at: Date.now(),
			watts: 250,
			target: 0,
			remaining: 0,
			elapsed: 60,
			label: 'Free ride',
			road: { grade: 6, km: 1, totalKm: 5, ahead: [2, 4, 6, 8, 10] },
		});
	});
	const bar = page.getByTestId('hud-ahead').locator('rect').first();
	await expect(bar).toBeAttached({ timeout: 15_000 });
	const { fill, grayText } = await bar.evaluate((rect) => {
		const probe = document.createElement('div');
		probe.style.cssText = 'color: GrayText; forced-color-adjust: none';
		document.body.append(probe);
		const grayText = getComputedStyle(probe).color;
		probe.remove();
		return { fill: getComputedStyle(rect).fill, grayText };
	});
	expect(fill).toBe(grayText);
});
