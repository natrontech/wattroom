// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	closeImage,
	image,
	openImage,
	toggleActual,
} from '$lib/chat/viewer.svelte';

const SRC = join(import.meta.dirname, '..', '..');

afterEach(closeImage);

describe('the image viewer', () => {
	it('opens a picture fit to the window', () => {
		openImage('/api/dms/images/abc', 'Image you sent');
		expect(image.src).toBe('/api/dms/images/abc');
		expect(image.alt).toBe('Image you sent');
		expect(image.actual).toBe(false);
	});

	it('closes, so the host draws nothing', () => {
		openImage('/api/dms/images/abc', 'Image you sent');
		closeImage();
		expect(image.src).toBe('');
	});

	it('toggles full size and back', () => {
		openImage('/api/dms/images/abc', 'Image you sent');
		toggleActual();
		expect(image.actual).toBe(true);
		toggleActual();
		expect(image.actual).toBe(false);
	});

	it('opens the next picture fit, whatever the last one was zoomed to', () => {
		openImage('/api/dms/images/abc', 'Image you sent');
		toggleActual();
		openImage('/api/rooms/test/chat/images/def', 'Sent by Jan');
		expect(image.actual).toBe(false);
	});
});

/**
 * The rider report behind #510: clicking a picture in a message opened a new
 * browser tab, where the room is gone and the way back is the tab bar. It was
 * one `target="_blank"` in ChatImage, so that is what this guards — the viewer
 * store above can be perfect while the thumbnail still hands the picture to
 * the browser.
 */
describe('a chat image (#510)', () => {
	const source = readFileSync(join(SRC, 'lib/chat/ChatImage.svelte'), 'utf8');

	it('does not navigate anywhere on click', () => {
		expect(source).not.toMatch(/<a\b/);
	});

	it('opens the in-app viewer instead', () => {
		expect(source).toContain('openImage(src, alt)');
	});

	it('keeps a new tab one right-click away', () => {
		// ux.md: the menu is a shortcut, never the only way — and nothing that
		// used to work should simply be gone.
		expect(source).toContain('Open in a new tab');
	});
});
