import { describe, expect, it } from 'vitest';
import { joinSessionPath } from '#lib/channel/address.ts';
import {
	ASK_EVERY_MS,
	joinIntent,
	shouldAskJoin,
	takeJoinDoor,
} from './join-intent.svelte.ts';

const at = (path: string) => new URL(path, 'http://x');

describe('joining a session is a choice (#4469)', () => {
	const base = {
		chosen: 's1',
		here: 's1',
		running: 's1',
		inSession: false,
		spectator: false,
		now: 10_000,
		askedAt: 0,
	};

	it('asks to join the session the rider chose, while the hub has them out', () => {
		expect(shouldAskJoin(base)).toBe(true);
	});

	it('only watches a session nobody chose on this tab', () => {
		expect(shouldAskJoin({ ...base, chosen: null })).toBe(false);
		expect(shouldAskJoin({ ...base, chosen: 's2' })).toBe(false);
	});

	it('asks nothing of a rider already in, a phone, or a session no longer running', () => {
		expect(shouldAskJoin({ ...base, inSession: true })).toBe(false);
		expect(shouldAskJoin({ ...base, spectator: true })).toBe(false);
		expect(shouldAskJoin({ ...base, running: undefined })).toBe(false);
		expect(shouldAskJoin({ ...base, running: 's2' })).toBe(false);
	});

	it('asks again after a lost join, at most every few seconds', () => {
		expect(
			shouldAskJoin({ ...base, askedAt: base.now - ASK_EVERY_MS + 1 }),
		).toBe(false);
		expect(shouldAskJoin({ ...base, askedAt: base.now - ASK_EVERY_MS })).toBe(
			true,
		);
	});

	it('forgets the choice on Leave, so the page never joins again by itself', () => {
		joinIntent.choose('s1');
		joinIntent.drop('s2');
		expect(joinIntent.chosen).toBe('s1');
		joinIntent.drop('s1');
		expect(joinIntent.chosen).toBeNull();
	});

	it('carries the ask on the address once, and takes it off', () => {
		const href = joinSessionPath('c1', 's1');
		expect(href).toBe('/crew/c1/s/s1?join=1');
		const door = takeJoinDoor(at(href))!;
		expect(door.rest.pathname + door.rest.search).toBe('/crew/c1/s/s1');
		expect(takeJoinDoor(at('/crew/c1/s/s1'))).toBeNull();
	});
});
