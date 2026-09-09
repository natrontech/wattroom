import { describe, expect, it } from 'vitest';
import { pairError } from './pair-error';

describe('pairError', () => {
	it('replaces the chooser message nobody in the shell caused (#1545)', () => {
		expect(
			pairError(
				new DOMException(
					'User cancelled the requestDevice() chooser.',
					'NotFoundError',
				),
			),
		).toMatch(/Wake the sensor/);
	});

	it('keeps the radio errors that say what happened', () => {
		expect(pairError(new Error('GATT operation failed'))).toBe(
			'GATT operation failed',
		);
	});

	it('has an answer for something that is not an error at all', () => {
		expect(pairError('nope')).toBe('Could not connect to that sensor.');
	});
});
