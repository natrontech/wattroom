// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
	closeImage,
	image,
	openImage,
	toggleActual,
} from '$lib/chat/viewer.svelte';

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
		openImage('/api/channels/c1/chat/images/def', 'Sent by Jan');
		expect(image.actual).toBe(false);
	});
});
