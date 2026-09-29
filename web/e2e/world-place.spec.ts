import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { GOLDEN_HASH } from '../src/lib/world/place/golden.test-helper';

/**
 * One world, whatever builds it (#3224): the golden world's placement hash is
 * pinned in Node by stroke.test.ts, and every engine — Chromium, WebKit and
 * Firefox (playwright.config.ts) — must reach it on the main thread and in a
 * worker alike. Advisory, like every e2e: a red one names an engine whose
 * arithmetic disagrees, which is a finding for the generator, not a flake.
 *
 * The place modules are bundled here, from source, with Vite's own build — the
 * app never ships them to a page on their own.
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
					new URL('./world-place.entry.ts', import.meta.url),
				),
				formats: ['iife'],
				name: 'Place',
			},
		},
	});
	const result = (Array.isArray(out) ? out[0] : out) as {
		output: { code: string }[];
	};
	bundle = result.output[0].code;
});

test('the golden world hashes alike on the main thread and in a worker', async ({
	page,
}) => {
	await page.setContent('<!doctype html><title>place</title>');
	await page.addScriptTag({ content: bundle });
	const main = await page.evaluate(() =>
		(
			window as unknown as { Place: { goldenHash(): string } }
		).Place.goldenHash(),
	);
	const worker = await page.evaluate(async (code) => {
		const url = URL.createObjectURL(
			new Blob([`${code}\nself.postMessage(Place.goldenHash());`], {
				type: 'text/javascript',
			}),
		);
		return new Promise<string>((resolve, reject) => {
			const w = new Worker(url);
			w.onmessage = (e) => resolve(e.data);
			w.onerror = (e) => reject(new Error(e.message));
		});
	}, bundle);
	expect(main).toBe(GOLDEN_HASH);
	expect(worker).toBe(GOLDEN_HASH);
});
