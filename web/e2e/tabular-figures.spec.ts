import { expect, test } from '@playwright/test';

/**
 * Display figures in one width (G4, #3922). Chakra Petch has no `tnum`, so
 * `tabular-nums` did nothing and a ticking clock shifted as its digits changed:
 * at 700 the 1 advances 0.382 em and the 0 0.652 em.
 */
test('every display figure advances the same width, at both weights', async ({
	page,
}) => {
	await page.goto('/login');
	const widths = await page.evaluate(async () => {
		const out: Record<string, number[] | boolean> = {};
		for (const weight of [500, 700]) {
			const runs = [...'0123456789'].map((figure) => {
				const span = document.createElement('span');
				span.className = 'font-display';
				span.style.cssText = `font-size: 100px; font-weight: ${weight}; position: absolute`;
				span.textContent = figure.repeat(8);
				document.body.append(span);
				return span;
			});
			const family = getComputedStyle(runs[0]).fontFamily;
			await document.fonts.load(`${weight} 100px ${family}`, '0123456789');
			out[weight] = runs.map((span) => span.getBoundingClientRect().width);
			runs.forEach((span) => span.remove());
		}
		// A fallback sans with tabular digits would pass the widths on its own.
		const faces = [...document.fonts].filter(
			(face) =>
				face.family.replace(/"/g, '') === 'WattRoom Figures' &&
				face.status === 'loaded',
		);
		out.loaded = ['500', '700'].every((weight) =>
			faces.some((face) => face.weight === weight),
		);
		return out;
	});
	expect(widths.loaded, 'WattRoom Figures loaded at 500 and 700').toBe(true);
	for (const weight of ['500', '700']) {
		const runs = widths[weight] as number[];
		expect(
			Math.max(...runs) - Math.min(...runs),
			`${weight}: ${runs.join(' ')}`,
		).toBeLessThan(1);
	}
});
