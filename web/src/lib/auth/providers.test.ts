import { describe, expect, it } from 'vitest';
import { providerRow, signInWays } from './providers';

// The desktop shell and the hand-off's back-to-the-app screen offer no
// provider on the page, so the row's "none configured" there told every
// desktop rider the server was broken (#2844).
describe('providerRow', () => {
	const ready = { loaded: true, providers: ['google'], unreachable: false };
	it('says nothing inside the shell or on the way back to it', () => {
		expect(providerRow(ready, true)).toBeNull();
		expect(providerRow({ ...ready, providers: [] }, true)).toBeNull();
		expect(
			providerRow({ ...ready, providers: [], unreachable: true }, true),
		).toBeNull();
	});
	it('in a browser, offers what the server has, or says why not', () => {
		expect(providerRow(ready, false)).toBe('providers');
		expect(providerRow({ ...ready, providers: [] }, false)).toBe(
			'unconfigured',
		);
		expect(
			providerRow({ ...ready, providers: [], unreachable: true }, false),
		).toBe('unreachable');
		expect(providerRow({ ...ready, loaded: false }, false)).toBeNull();
	});
});

// The shell's line named a fixed "GitHub or Strava" and left out Google,
// the very provider ADR-0040 sends riders to the browser for (#2844).
describe('signInWays', () => {
	it('names the passkey and every provider the server offers', () => {
		expect(signInWays(['google', 'github', 'strava'])).toBe(
			'Your passkey, Google, GitHub or Strava',
		);
		expect(signInWays(['github'])).toBe('Your passkey or GitHub');
		expect(signInWays([])).toBe('Your passkey');
	});
});
