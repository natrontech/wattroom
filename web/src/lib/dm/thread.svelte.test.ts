// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen: Record<string, number> = {};
const stamped: string[] = [];
let bumped = 0;

vi.mock('$lib/dm/dm.svelte', () => ({
	dm: {
		seenAt: (peerId: string) => seen[peerId] ?? 0,
		stampSeen: (peerId: string) => stamped.push(peerId),
	},
}));
vi.mock('$lib/dm/heads.svelte', () => ({
	dmHeads: { bump: () => bumped++ },
}));
vi.mock('$lib/account.svelte', () => ({ account: { me: { id: 'me-1' } } }));

let responses: unknown[] = [];
let postResponses: unknown[] = [];
const posted: unknown[] = [];
vi.mock('$lib/api', () => ({
	api: async (path: string, init?: { method?: string; json?: unknown }) => {
		if (init?.method === 'POST') {
			posted.push({ path, json: init.json });
			return postResponses.shift() ?? { ok: true, data: { id: 'sent-1' } };
		}
		const next = responses.shift();
		return next ?? { ok: false, error: { error: 'network', message: 'down' } };
	},
}));

const { createDmThread } = await import('./thread.svelte');

afterEach(() => {
	responses = [];
	postResponses = [];
	posted.length = 0;
	stamped.length = 0;
	bumped = 0;
	for (const k of Object.keys(seen)) delete seen[k];
});

describe('createDmThread (#672)', () => {
	it('captures readAt from the reader-owned localStorage stamp, before it moves', () => {
		seen['sven'] = 111;
		const thread = createDmThread('sven', () => 'Sven');
		expect(thread.readAt).toBe(111);
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
		const messages = thread.timeline.flatMap((e) =>
			e.kind === 'message' ? [e.message] : [],
		);
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
		expect(stamped).toEqual(['sven']);
		expect(bumped).toBe(1);
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
		const ids = thread.timeline.flatMap((e) =>
			e.kind === 'message' ? [e.message.id] : [],
		);
		// retry() reloads from 0, so this proves the merge-by-id path used in
		// the poll timer (same `load` function) doesn't duplicate the boundary.
		expect(new Set(ids).size).toBe(ids.length);
		thread.close();
	});

	it('does not stamp seen while the tab is hidden (audit #219)', async () => {
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
		expect(stamped).toEqual([]);
		expect(bumped).toBe(0);
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
});
