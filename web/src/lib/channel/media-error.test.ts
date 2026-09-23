import { describe, expect, it } from 'vitest';
import { describeMediaError } from './media-error';

// A DOMException in the browser; an Error with the same `name` is what the
// helper reads, and all it can rely on across browsers.
function named(name: string) {
	const err = new Error('Permission denied');
	err.name = name;
	return err;
}

describe('describeMediaError', () => {
	// #642: a rider who denied the permission pressed the mic and nothing
	// happened. The message has to point at the one control that fixes it.
	it('sends a blocked microphone to the address bar', () => {
		expect(describeMediaError(named('NotAllowedError'), 'microphone')).toBe(
			'Your browser is blocking the microphone — allow it in the address bar and try again.',
		);
	});

	it('names the camera when the camera is what is blocked', () => {
		expect(describeMediaError(named('NotAllowedError'), 'camera')).toMatch(
			/blocking the camera/,
		);
	});

	it('says when there is no microphone at all', () => {
		expect(describeMediaError(named('NotFoundError'), 'microphone')).toBe(
			'No microphone found — plug one in and try again.',
		);
	});

	it('says when another app holds the device', () => {
		expect(describeMediaError(named('NotReadableError'), 'camera')).toMatch(
			/Another app is using the camera/,
		);
	});

	// Cancelling the share picker rejects exactly like a policy block, and a
	// rider who pressed Cancel a second ago needs no status about it.
	it('stays quiet about a share picker the rider closed', () => {
		expect(describeMediaError(named('NotAllowedError'), 'screen')).toBe(null);
	});

	it('still names the step when the browser gives no usable name', () => {
		expect(describeMediaError(new Error('boom'), 'microphone')).toBe(
			'The microphone could not be started — try again.',
		);
		expect(describeMediaError('not even an error', 'screen')).toBe(
			'Screen sharing could not be started — try again.',
		);
	});
});
