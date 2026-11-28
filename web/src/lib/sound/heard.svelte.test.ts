import { beforeEach, describe, expect, it } from 'vitest';
import { forgetHeard, heard, hear, HEARD_KEPT } from './heard.svelte.ts';
import { ago } from './heard-ago.ts';

describe('heard', () => {
	beforeEach(forgetHeard);

	it('keeps the newest first, in the call site’s words or the cue’s name', () => {
		hear('leave', 'Sven stepped away', 1000);
		hear('block', undefined, 5000);
		expect(heard.list.map((h) => h.text)).toEqual([
			'Block change',
			'Sven stepped away',
		]);
	});

	it('says a countdown once, not once per tick', () => {
		hear('countdown', 'Starting', 0);
		hear('countdown', 'Starting', 1000);
		hear('countdown', 'Starting', 2000);
		expect(heard.list).toHaveLength(1);
		expect(heard.list[0].at).toBe(2000);
	});

	it('repeats the same words when they are a new event', () => {
		hear('join', 'Sven joined voice', 0);
		hear('join', 'Sven joined voice', 30_000);
		expect(heard.list).toHaveLength(2);
	});

	it('leaves out what the rider’s own press makes', () => {
		hear('shift-up');
		hear('shutter');
		expect(heard.list).toHaveLength(0);
	});

	it('forgets past what it keeps', () => {
		for (let i = 0; i < HEARD_KEPT + 5; i++) hear('chat', `m${i}`, i * 10_000);
		expect(heard.list).toHaveLength(HEARD_KEPT);
		expect(heard.list[0].text).toBe(`m${HEARD_KEPT + 4}`);
	});
});

describe('ago', () => {
	it.each([
		[0, 'now'],
		[12_000, '12 s ago'],
		[185_000, '3 min ago'],
		[2 * 3600_000, '2 h ago'],
	])('%i ms is %s', (ms, want) => expect(ago(ms)).toBe(want));
});
