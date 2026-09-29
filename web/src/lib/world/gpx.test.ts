import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFailureMessage, parseGpx } from './gpx';

afterEach(() => vi.restoreAllMocks());

describe('a loaded file that does not become a world', () => {
	it('says what is wrong with the file when the file is at fault', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		let err: unknown;
		try {
			parseGpx('<gpx><trk><trkseg></trkseg></trk></gpx>');
		} catch (e) {
			err = e;
		}
		expect(buildFailureMessage(err)).toMatch(/fewer than two track points/);
		expect(logged).not.toHaveBeenCalled();
	});

	it('owns a failure that is not the file’s, and logs it', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cause = new RangeError('Invalid typed array length');
		const message = buildFailureMessage(cause);
		// A generator bug once read as "not a GPX track", with nothing logged.
		expect(message).not.toMatch(/not a GPX/);
		expect(message).toMatch(/could not be built from this file/);
		expect(logged).toHaveBeenCalledWith(
			'world: a loaded route did not build',
			cause,
		);
	});
});
