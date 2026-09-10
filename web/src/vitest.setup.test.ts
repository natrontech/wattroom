// @vitest-environment happy-dom
/**
 * The test environment's own contract, not a product feature. A happy-dom test
 * must find a working `localStorage` on every Node the repo is run on: Node 26
 * ships an inert one that vitest's happy-dom environment then declines to
 * replace, which turned four green tests red locally while CI's Node 24 stayed
 * green (#2058). src/vitest.setup.ts is what holds this up; assert it here so
 * the next Node that moves a global fails one obvious test instead of an
 * arbitrary handful that look like product bugs.
 */
import { describe, expect, it } from 'vitest';

describe('the happy-dom test environment (#2058)', () => {
	it('hands a test a localStorage that stores', () => {
		localStorage.setItem('wattroom.setup.probe', 'stored');
		expect(localStorage.getItem('wattroom.setup.probe')).toBe('stored');
	});

	it('hands a test a localStorage that clears', () => {
		localStorage.setItem('wattroom.setup.probe', 'stored');
		localStorage.clear();
		expect(localStorage.getItem('wattroom.setup.probe')).toBeNull();
	});
});
