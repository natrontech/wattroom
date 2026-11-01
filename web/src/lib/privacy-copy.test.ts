import { describe, expect, it } from 'vitest';
import { routeNameLine } from './privacy-copy';

describe('routeNameLine', () => {
	// A narrow hint split "571" from its "m" inside the quoted name (#3680).
	it('keeps the quoted name on one line', () => {
		const quoted = routeNameLine('Road · 7.1 km · 571 m').split('“')[1];
		expect(quoted).not.toMatch(/ /);
	});
});
