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

	it('tells a strap that refused the link what to try (#2650)', () => {
		expect(
			pairError(
				new DOMException('Connection attempt failed', 'NetworkError'),
				'heart-rate',
			),
		).toMatch(/^Connection attempt failed\. On a Garmin HRM 600.*Retry/);
	});

	it('keeps the strap hint off a chooser that found nothing', () => {
		expect(
			pairError(
				new DOMException('User cancelled', 'NotFoundError'),
				'heart-rate',
			),
		).not.toMatch(/Garmin/);
	});
});
