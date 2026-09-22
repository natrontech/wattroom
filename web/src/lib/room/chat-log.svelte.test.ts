import { beforeEach, describe, expect, it, vi } from 'vitest';

const played: string[] = [];
vi.mock('$lib/sound/cues', () => ({ play: (cue: string) => played.push(cue) }));

import { createChatLog, reactedByOthers } from '$lib/room/chat-log.svelte';

const line = (id: string, at: number, extra: Record<string, unknown> = {}) => ({
	id,
	from: 'Ana',
	fromId: 'ana',
	text: `line ${id}`,
	at,
	...extra,
});

// Chat left the tick (#2437): the backlog is read again on every lobby ping,
// and each read is the whole truth — an edit, a deletion or a reaction made
// anywhere reads that way on the next one.
describe('the room chat log', () => {
	beforeEach(() => {
		played.length = 0;
	});

	it('replaces the log with each read, in time order', () => {
		const chat = createChatLog();
		chat.seed([line('b', 2), line('a', 1)]);
		expect(chat.log.map((l) => l.id)).toEqual(['a', 'b']);
		// b was edited, a was deleted, c was said.
		chat.seed([line('b', 2, { text: 'fixed', editedAt: 9 }), line('c', 3)]);
		expect(chat.log.map((l) => [l.id, l.text, l.editedAt])).toEqual([
			['b', 'fixed', 9],
			['c', 'line c', undefined],
		]);
	});

	it('takes a deleted line’s reactions with it', () => {
		const chat = createChatLog();
		chat.seed([line('a', 1, { reactions: { flame: 2 }, mine: ['flame'] })]);
		expect(chat.reactions).toEqual({ a: { flame: 2 } });
		expect(chat.myReacts).toEqual({ 'a:flame': true });
		chat.seed([]);
		expect(chat.reactions).toEqual({});
		expect(chat.myReacts).toEqual({});
	});

	it('keeps the last 200 lines', () => {
		const chat = createChatLog();
		chat.seed(Array.from({ length: 250 }, (_, i) => line(`m${i}`, i)));
		expect(chat.log).toHaveLength(200);
		expect(chat.log[0].id).toBe('m50');
	});

	it('draws my own press before the answer', () => {
		const chat = createChatLog();
		chat.seed([line('a', 1)]);
		chat.toggleMine('a', 'flame');
		expect(chat.myReacts['a:flame']).toBe(true);
		chat.toggleMine('a', 'flame');
		expect(chat.myReacts['a:flame']).toBe(false);
	});

	it('sounds somebody else’s reaction, never the first read or my own (#834)', () => {
		const chat = createChatLog();
		chat.seed([line('a', 1, { reactions: { flame: 1 } })]);
		expect(played).toEqual([]);
		chat.seed([line('a', 1, { reactions: { flame: 2 } })]);
		expect(played).toEqual(['reaction']);
		chat.seed([
			line('a', 1, { reactions: { flame: 2, heart: 1 }, mine: ['heart'] }),
		]);
		expect(played).toEqual(['reaction']);
	});
});

describe('reactedByOthers', () => {
	it('is a rise on a reaction the reader does not hold', () => {
		expect(reactedByOthers({}, { a: { x: 1 } }, {})).toBe(true);
		expect(reactedByOthers({ a: { x: 1 } }, { a: { x: 1 } }, {})).toBe(false);
		expect(reactedByOthers({ a: { x: 2 } }, { a: { x: 1 } }, {})).toBe(false);
		expect(reactedByOthers({}, { a: { x: 1 } }, { 'a:x': true })).toBe(false);
	});
});
