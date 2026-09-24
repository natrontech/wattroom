// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const reads: string[] = [];
let refreshed = 0;

vi.mock('$lib/dm/heads.svelte', () => ({
	dmHeads: { refresh: () => refreshed++ },
}));
vi.mock('$lib/account.svelte', () => ({ account: { me: { id: 'me-1' } } }));

let responses: unknown[] = [];
let postResponses: unknown[] = [];
const posted: unknown[] = [];
vi.mock('$lib/api', () => ({
	api: async (path: string, init?: { method?: string; json?: unknown }) => {
		if (init?.method === 'POST' && path.endsWith('/read')) {
			reads.push(path);
			return { ok: true, data: null };
		}
		if (init?.method === 'POST') {
			posted.push({ path, json: init.json });
			return postResponses.shift() ?? { ok: true, data: { id: 'sent-1' } };
		}
		const next = responses.shift();
		return next ?? { ok: false, error: { error: 'network', message: 'down' } };
	},
}));

const { createDmThread, POLL_MS } = await import('./thread.svelte');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	responses = [];
	postResponses = [];
	posted.length = 0;
	reads.length = 0;
	refreshed = 0;
});

describe('createDmThread (#672)', () => {
	// The cursor is the server's (#2711), so a read on another device moves
	// it — but only the first page places the "N new" line, which must not
	// creep down while you read.
	it('takes readAt from the first page and keeps it there', async () => {
		responses.push(
			{ ok: true, data: { messages: [], readAt: 111 } },
			{ ok: true, data: { messages: [], readAt: 999 } },
		);
		const thread = createDmThread('sven', () => 'Sven');
		expect(thread.readAt).toBeNull();
		thread.start();
		await flush();
		expect(thread.readAt).toBe(111);
		thread.retry();
		await flush();
		expect(thread.readAt).toBe(111);
		thread.close();
	});

	it('loads the backlog into the shared timeline shape', async () => {
		responses.push({
			ok: true,
			data: {
				messages: [
					{ id: 'a', mine: false, text: 'hey', at: 1 },
					{ id: 'b', mine: true, text: 'hi back', at: 2 },
				],
			},
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();
		expect(thread.loading).toBe(false);
		const messages = thread.timeline.map((e) => e.message);
		expect(messages).toEqual([
			{
				id: 'a',
				from: 'Sven',
				fromId: 'sven',
				text: 'hey',
				imageId: undefined,
				at: 1,
			},
			{
				id: 'b',
				from: 'You',
				fromId: 'me-1',
				text: 'hi back',
				imageId: undefined,
				at: 2,
			},
		]);
		await flush();
		expect(reads).toEqual(['/api/dms/sven/read']);
		expect(refreshed).toBe(1);
		thread.close();
	});

	it('merges a later poll by id instead of duplicating the boundary line', async () => {
		responses.push({
			ok: true,
			data: { messages: [{ id: 'a', mine: false, text: 'hey', at: 1 }] },
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();

		responses.push({
			ok: true,
			data: {
				messages: [
					{ id: 'a', mine: false, text: 'hey', at: 1 }, // boundary re-sent
					{ id: 'c', mine: false, text: 'you there?', at: 5 },
				],
			},
		});
		await thread.retry();
		await Promise.resolve();
		await Promise.resolve();
		const ids = thread.timeline.map((e) => e.message.id);
		// retry() reloads from 0, so this proves the merge-by-id path used in
		// the poll timer (same `load` function) doesn't duplicate the boundary.
		expect(new Set(ids).size).toBe(ids.length);
		thread.close();
	});

	it('does not mark it read while the tab is hidden (audit #219)', async () => {
		Object.defineProperty(document, 'hidden', {
			value: true,
			configurable: true,
		});
		responses.push({
			ok: true,
			data: { messages: [{ id: 'a', mine: false, text: 'hey', at: 1 }] },
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();
		await flush();
		expect(reads).toEqual([]);
		expect(refreshed).toBe(0);
		thread.close();
		Object.defineProperty(document, 'hidden', {
			value: false,
			configurable: true,
		});
	});

	it('send() posts the draft, uploading an image first when there is one', async () => {
		responses.push({ ok: true, data: { messages: [] } });
		const thread = createDmThread('sven', () => 'Sven');
		const refusal = await thread.send('yo');
		expect(refusal).toBeNull();
		expect(posted).toEqual([
			{ path: '/api/dms/sven', json: { text: 'yo', imageId: undefined } },
		]);
		thread.close();
	});
});

describe('createDmThread reactions (#777)', () => {
	it('loads the pair-wide reaction map alongside the backlog', async () => {
		responses.push({
			ok: true,
			data: {
				messages: [{ id: 'a', mine: false, text: 'hey', at: 1 }],
				reactions: { a: { '🔥': 2 } },
				myReacts: { a: ['🔥'] },
			},
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();
		expect(thread.reactions).toEqual({ a: { '🔥': 2 } });
		expect(thread.myReacts).toEqual({ 'a:🔥': true });
		thread.close();
	});

	it('react() is optimistic and corrects from the server answer', async () => {
		responses.push({ ok: true, data: { messages: [] } });
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();

		postResponses.push({
			ok: true,
			data: { messageId: 'a', emoji: '🔥', count: 1, added: true },
		});
		const reactPromise = thread.react('a', '🔥');
		// Optimistic flip lands before the response resolves.
		expect(thread.myReacts['a:🔥']).toBe(true);
		const refusal = await reactPromise;
		expect(refusal).toBeNull();
		expect(thread.reactions).toEqual({ a: { '🔥': 1 } });
		expect(posted).toContainEqual({
			path: '/api/dms/sven/reactions',
			json: { messageId: 'a', emoji: '🔥' },
		});
		thread.close();
	});

	it('react() rolls back the optimistic flip on failure', async () => {
		responses.push({ ok: true, data: { messages: [] } });
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();

		postResponses.push({
			ok: false,
			error: { error: 'not_found', message: 'No such message.' },
		});
		const refusal = await thread.react('a', '🔥');
		expect(refusal).toBe('No such message.');
		expect(thread.myReacts['a:🔥']).toBeFalsy();
		thread.close();
	});
	it('applies an edit to a line the incremental poll can never bring back (#865)', async () => {
		// `after` filters on created_at, which an edit leaves alone: the second
		// poll returns no messages at all, and the new text has to arrive in
		// the edits map or the reader keeps staring at the old words.
		vi.useFakeTimers();
		responses.push({
			ok: true,
			data: { messages: [{ id: 'a', mine: true, text: 'ride at 6?', at: 5 }] },
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();
		expect(thread.timeline[0]).toMatchObject({
			message: { text: 'ride at 6?', editedAt: undefined },
		});

		responses.push({
			ok: true,
			data: {
				messages: [],
				edits: { a: { messageId: 'a', text: 'ride at 7?', editedAt: 9 } },
			},
		});
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(thread.timeline[0]).toMatchObject({
			message: { text: 'ride at 7?', editedAt: 9 },
		});
		thread.close();
		vi.useRealTimers();
	});

	it('edit() PATCHes the message and shows the new words at once', async () => {
		responses.push({
			ok: true,
			data: { messages: [{ id: 'a', mine: true, text: 'ride at 6?', at: 5 }] },
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();

		responses.push({
			ok: true,
			data: { messageId: 'a', text: 'ride at 7?', editedAt: 9 },
		});
		expect(await thread.edit('a', 'ride at 7?')).toBeNull();
		expect(thread.timeline[0]).toMatchObject({
			message: { text: 'ride at 7?', editedAt: 9 },
		});
		thread.close();
	});

	it('edit() hands the refusal back and leaves the line alone', async () => {
		responses.push({
			ok: true,
			data: { messages: [{ id: 'a', mine: true, text: 'ride at 6?', at: 5 }] },
		});
		const thread = createDmThread('sven', () => 'Sven');
		thread.start();
		await Promise.resolve();
		await Promise.resolve();

		responses.push({
			ok: false,
			error: {
				error: 'forbidden',
				message: 'You can only edit your own messages.',
			},
		});
		expect(await thread.edit('a', 'mine now')).toBe(
			'You can only edit your own messages.',
		);
		expect(thread.timeline[0]).toMatchObject({
			message: { text: 'ride at 6?' },
		});
		thread.close();
	});
});
