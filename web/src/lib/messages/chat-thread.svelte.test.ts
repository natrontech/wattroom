// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/presence.svelte', () => ({ presence: { reload: () => {} } }));

type Pending = {
	path: string;
	method?: string;
	json?: unknown;
	resolve: (v: unknown) => void;
};
const calls: Pending[] = [];
vi.mock('$lib/api', () => ({
	api: (path: string, init?: { method?: string; json?: unknown }) =>
		new Promise((resolve) =>
			calls.push({ path, method: init?.method, json: init?.json, resolve }),
		),
}));

const { createChatThread } = await import('./chat-thread.svelte');

const line = (id: string, text: string) => ({ id, from: 'Ana', text, at: 1 });
const backlog = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
	ok: true,
	data: { messages, readAt: 0, ...extra },
});
const settle = () => new Promise((r) => setTimeout(r, 0));
/** The newest pending GET of the backlog, answered. */
const answer = (at: number, value: unknown) => {
	const reads = calls.filter((c) => c.path.endsWith('/chat') && !c.method);
	reads[at].resolve(value);
};

describe('a chat thread over HTTP (#2448)', () => {
	it('lets only the newest read land — an older answer cannot bring a deleted line back', async () => {
		calls.length = 0;
		const thread = createChatThread('/api/channels/c1');
		thread.start();
		thread.reload();
		// The second read answers first, without the line somebody deleted…
		answer(1, backlog([line('a', 'kept')]));
		await settle();
		// …then the first, older read arrives still holding it.
		answer(0, backlog([line('a', 'kept'), line('b', 'deleted')]));
		await settle();
		expect(thread.messages.map((m) => m.id)).toEqual(['a']);
		thread.close();
	});

	it('marks read up to the newest line it showed, not "now" (#2755)', async () => {
		calls.length = 0;
		const thread = createChatThread('/api/channels/c1');
		thread.start();
		answer(0, backlog([line('a', 'warm-up at 7?'), line('b', 'make it 7:30')]));
		await settle();
		const reads = calls.filter((c) => c.path.endsWith('/read'));
		expect(reads.map((c) => [c.path, c.json])).toEqual([
			['/api/channels/c1/read', { upTo: 'b' }],
		]);
		thread.close();
	});

	it('reads its paths under the base it was given', async () => {
		calls.length = 0;
		const thread = createChatThread('/api/channels/c2');
		thread.start();
		expect(calls[0].path).toBe('/api/channels/c2/chat');
		thread.close();
	});

	it('carries the channel’s marked line, and none once it is taken down', async () => {
		calls.length = 0;
		const thread = createChatThread('/api/channels/c1');
		thread.start();
		const put = { messageId: 'a', text: 'kept', from: 'Ana', at: '' };
		answer(0, backlog([line('a', 'kept')], { announcement: put }));
		await settle();
		expect(thread.announcement).toEqual(put);
		thread.reload();
		answer(1, backlog([line('a', 'kept')]));
		await settle();
		expect(thread.announcement).toBeNull();
		thread.close();
	});
});
