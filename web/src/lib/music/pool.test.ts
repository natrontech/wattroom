import { describe, expect, it } from 'vitest';
import {
	MAX_UPLOAD_BYTES,
	trackClock,
	trackSize,
	whyNotUploadable,
} from './pool';

/** Only the three fields the check reads — a real File cannot be 48 MB in a test. */
const file = (name: string, size: number, type = '') =>
	({ name, size, type }) as File;

describe('whyNotUploadable', () => {
	it('takes an MP3 by type or by extension', () => {
		expect(whyNotUploadable(file('song.mp3', 1000))).toBeNull();
		expect(whyNotUploadable(file('SONG.MP3', 1000))).toBeNull();
		// Some browsers hand over a type and no useful name, and some the reverse.
		expect(whyNotUploadable(file('export', 1000, 'audio/mpeg'))).toBeNull();
	});

	it('says which file and why, because a rider may have dropped twenty', () => {
		expect(whyNotUploadable(file('cover.png', 1000))).toBe(
			'cover.png is not an MP3.',
		);
		expect(whyNotUploadable(file('epic.mp3', MAX_UPLOAD_BYTES + 1))).toBe(
			'epic.mp3 is over 48 MB.',
		);
		expect(whyNotUploadable(file('empty.mp3', 0))).toBe('empty.mp3 is empty.');
	});
});

describe('formatting', () => {
	it('reads a duration the way every other clock in the app does', () => {
		expect(trackClock(0)).toBe('0:00');
		expect(trackClock(9_000)).toBe('0:09');
		expect(trackClock(212_000)).toBe('3:32');
		expect(trackClock(3_600_000)).toBe('60:00');
	});

	it('drops the decimal once a size is big enough not to need it', () => {
		expect(trackSize(1 << 20)).toBe('1.0 MB');
		expect(trackSize(4.25 * (1 << 20))).toBe('4.3 MB');
		expect(trackSize(12.4 * (1 << 20))).toBe('12 MB');
	});
});
