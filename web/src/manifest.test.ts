import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The installed web app (ADR-0090). Nothing in a browser tab shows a wrong
 * manifest: a narrow scope only surfaces as Safari's back and forward bar on
 * a home-screen WattRoom, and a transparent touch icon as a black frame.
 */
const web = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(web, path));
const shell = read('src/app.html').toString();

type Icon = { src: string; sizes: string; type: string; purpose: string };
const manifest = JSON.parse(read('static/manifest.webmanifest').toString()) as {
	id: string;
	start_url: string;
	scope: string;
	display: string;
	theme_color: string;
	icons: Icon[];
};

// The size and colour type from a PNG's IHDR chunk.
function png(path: string) {
	const bytes = read(join('static', path));
	expect(bytes.subarray(1, 4).toString(), path).toBe('PNG');
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
		// 2 is RGB, 6 is RGBA (PNG §11.2.2).
		opaque: bytes[25] === 2,
	};
}

describe('the web app manifest', () => {
	it('scopes the app to the whole origin', () => {
		expect(manifest.scope).toBe('/');
		expect(manifest.id).toBe('/');
		expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
		expect(manifest.display).toBe('standalone');
	});

	it('is linked from every page, with the shell’s colour', () => {
		expect(shell).toContain(
			'<link rel="manifest" href="/manifest.webmanifest" />',
		);
		expect(shell).toContain(`content="${manifest.theme_color}"`);
		expect(shell).toContain('viewport-fit=cover');
	});

	it('names icons that exist at the sizes it claims', () => {
		for (const icon of manifest.icons) {
			const { width, height } = png(icon.src);
			expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
			expect(icon.type).toBe('image/png');
		}
		const has = (purpose: string, sizes: string) =>
			manifest.icons.some((i) => i.purpose === purpose && i.sizes === sizes);
		// What Chrome asks for to install, and what a launcher's mask needs.
		expect(has('any', '192x192') && has('any', '512x512')).toBe(true);
		expect(has('maskable', '512x512')).toBe(true);
	});

	it('gives maskable and home-screen icons no transparency to fill black', () => {
		const touch = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(
			shell,
		)?.[1];
		expect(touch).toBeDefined();
		expect(png(touch!)).toEqual({ width: 180, height: 180, opaque: true });
		for (const icon of manifest.icons.filter((i) => i.purpose === 'maskable'))
			expect(png(icon.src).opaque, icon.src).toBe(true);
	});
});
