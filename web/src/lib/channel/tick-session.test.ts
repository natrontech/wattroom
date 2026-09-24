import { describe, expect, it } from 'vitest';
import { coachOf, liveSessionId } from './tick-session';

describe('liveSessionId', () => {
	it.each([
		['countdown', 's1'],
		['running', 's1'],
		['paused', 's1'],
		['done', undefined],
		['idle', undefined],
	])('a %s session with an id → %s', (phase, want) => {
		expect(liveSessionId({ phase, id: 's1' })).toBe(want);
	});
	it('has nothing to follow before a session opens', () => {
		expect(liveSessionId({ phase: 'running' })).toBeUndefined();
		expect(liveSessionId(undefined)).toBeUndefined();
	});
});

describe('coachOf (#2596)', () => {
	it.each([
		['idle', 'ana'],
		['countdown', 'ana'],
		['running', 'ana'],
		['paused', 'ana'],
		['done', undefined],
	])('a %s session coached by ana → %s', (phase, want) => {
		expect(coachOf({ phase, id: 's1', coach: 'ana' })).toBe(want);
	});
	it('names nobody before a session opens', () => {
		expect(coachOf({ phase: 'idle' })).toBeUndefined();
		expect(coachOf(undefined)).toBeUndefined();
	});
});
