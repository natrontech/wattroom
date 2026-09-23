import { describe, expect, it } from 'vitest';
import { liveSessionId } from './tick-session';

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
