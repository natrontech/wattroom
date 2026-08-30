import { beforeEach, describe, expect, it } from 'vitest';
import { rememberNext, takeNext } from './next';

describe('login next-stash', () => {
	beforeEach(() => sessionStorage.clear());

	it('round-trips a same-origin path and clears it', () => {
		rememberNext('/r/velvet-hammer?tab=medals');
		expect(takeNext()).toBe('/r/velvet-hammer?tab=medals');
		expect(takeNext()).toBeNull();
	});

	it('drops open redirects and junk', () => {
		for (const bad of [
			'//evil.example',
			'https://evil.example/x',
			'javascript:alert(1)',
			'',
			null,
		]) {
			rememberNext(bad);
			expect(takeNext()).toBeNull();
		}
	});

	it('a later junk value clears an earlier good one', () => {
		rememberNext('/rooms');
		rememberNext('//evil.example');
		expect(takeNext()).toBeNull();
	});
});
