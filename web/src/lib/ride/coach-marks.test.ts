import { afterEach, expect, test, vi } from 'vitest';
import { COACH_MARKS, coachDone, coachSeen } from './coach-marks';

afterEach(() => vi.unstubAllGlobals());

test('the marks are three, and done stays done', () => {
	const kept = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => kept.get(k) ?? null,
		setItem: (k: string, v: string) => void kept.set(k, v),
	});
	expect(COACH_MARKS).toHaveLength(3);
	expect(coachSeen()).toBe(false);
	coachDone();
	expect(coachSeen()).toBe(true);
});

test('storage that throws shows the marks and never throws', () => {
	const boom = () => {
		throw new Error('blocked');
	};
	vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
	expect(coachSeen()).toBe(false);
	expect(coachDone).not.toThrow();
});
