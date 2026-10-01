import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/**
 * The figure's material compiles and blurs (#3073): drawn in Chromium's own
 * WebGL, the rear wheel's spokes move when it turns at rest,
 * and once the frame's sweep passes 0.35 of a spoke period the wheel no longer
 * changes at all — nothing left to strobe. Advisory, like every e2e; the
 * coverage itself is pinned in Node by material.test.ts.
 */

let bundle = '';

test.beforeAll(async () => {
	const out = await build({
		configFile: false,
		logLevel: 'silent',
		resolve: {
			alias: { $lib: fileURLToPath(new URL('../src/lib', import.meta.url)) },
		},
		build: {
			write: false,
			minify: false,
			lib: {
				entry: fileURLToPath(
					new URL('./world-figure.entry.ts', import.meta.url),
				),
				formats: ['iife'],
				name: 'Figure',
			},
		},
	});
	const result = (Array.isArray(out) ? out[0] : out) as {
		output: { code: string }[];
	};
	bundle = result.output[0].code;
});

test('the spokes show at rest and go uniform past 0.35 of a period a frame', async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(e.message));
	await page.setContent('<!doctype html><title>figure</title><body></body>');
	await page.addScriptTag({ content: bundle });
	const [rest, fast] = await page.evaluate(() => {
		const F = (
			window as unknown as {
				Figure: { change(s: number): number; period(): number };
			}
		).Figure;
		return [F.change(0), F.change(0.5 * F.period())];
	});
	expect(errors).toEqual([]);
	expect(rest).toBeGreaterThan(0.01);
	expect(fast).toBeLessThan(rest / 20);
});
