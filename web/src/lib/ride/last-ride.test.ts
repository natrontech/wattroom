// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	lastRoad,
	lastWorkout,
	rememberRoad,
	rememberWorkout,
} from './last-ride';

describe('what /ride remembers (#3671)', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.unstubAllGlobals());

	it('keeps the road and the workout apart', () => {
		rememberRoad('route-1');
		rememberWorkout('sweet-spot-2x20');
		rememberRoad('route-2');
		expect(lastRoad()).toBe('route-2');
		expect(lastWorkout()).toBe('sweet-spot-2x20');
	});

	it('remembers nothing where storage throws', () => {
		const refuse = () => {
			throw new Error('denied');
		};
		vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse });
		expect(() => rememberRoad('route-1')).not.toThrow();
		expect(lastRoad()).toBeUndefined();
	});
});
