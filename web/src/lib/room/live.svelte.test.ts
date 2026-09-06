// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/ride/buffer', () => ({
	openRideBuffer: async () => ({
		append() {},
		end() {},
		since: async () => [],
	}),
}));

/** A room socket that is dialled but never answers until the test says so. */
class FakeSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static last: FakeSocket | null = null;
	readyState = FakeSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	sent: string[] = [];
	constructor(public url: string) {
		FakeSocket.last = this;
	}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.readyState = FakeSocket.CLOSED;
	}
	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}
}
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

const { createRoomLive } = await import('./live.svelte');

const QUEUE = 16;

describe('room live send while reconnecting', () => {
	beforeEach(() => {
		FakeSocket.last = null;
	});

	it('queues chat until the socket opens, then flushes it in order', () => {
		const live = createRoomLive('flush');
		const socket = FakeSocket.last!;
		expect(live.chat('one')).toBe(true);
		expect(live.chat('two')).toBe(true);
		expect(socket.sent).toEqual([]);
		socket.open();
		const texts = socket.sent.map((raw) => JSON.parse(raw).chat?.text);
		expect(texts.slice(0, 2)).toEqual(['one', 'two']);
	});

	it('refuses the line the queue cannot hold instead of dropping it (#650)', () => {
		const live = createRoomLive('full');
		const socket = FakeSocket.last!;
		for (let i = 0; i < QUEUE; i++) expect(live.chat(`line ${i}`)).toBe(true);
		expect(live.chat('one too many')).toBe(false);
		socket.open();
		const texts = socket.sent
			.map((raw) => JSON.parse(raw).chat?.text)
			.filter(Boolean);
		expect(texts).toHaveLength(QUEUE);
		expect(texts).not.toContain('one too many');
		// The wire is back: the next line goes straight out.
		expect(live.chat('after')).toBe(true);
		expect(JSON.parse(socket.sent.at(-1)!).chat.text).toBe('after');
	});

	it('drops metrics without queueing or complaining — stale watts help nobody', () => {
		const live = createRoomLive('metrics');
		const socket = FakeSocket.last!;
		for (let i = 0; i < QUEUE; i++) live.chat(`line ${i}`);
		live.sendMetrics({ watts: 200, cadence: 90 });
		socket.open();
		expect(socket.sent.some((raw) => 'metrics' in JSON.parse(raw))).toBe(false);
		// The full queue was chat, not watts: metrics never took a slot.
		expect(live.chat('after')).toBe(true);
	});

	it('keeps jukebox refusals separate for the add surface', () => {
		const live = createRoomLive('jukebox-refusal');
		const socket = FakeSocket.last!;
		socket.open();
		socket.onmessage?.({
			data: JSON.stringify({
				error: {
					code: 'jukebox_invalid_video',
					message: 'That video link is not playable here.',
				},
			}),
		});
		expect(live.jukeboxRefusal).toBe('That video link is not playable here.');
		expect(live.refusal).toBeNull();
		live.jukebox({ action: 'add', videoId: 'dQw4w9WgXcQ' });
		expect(live.jukeboxRefusal).toBeNull();
	});
});

describe('room live chat edits (#865)', () => {
	beforeEach(() => {
		FakeSocket.last = null;
	});

	/** One tick, as the server sends it — only the fields a test cares about. */
	const tick = (socket: FakeSocket, fields: Record<string, unknown>) =>
		socket.onmessage?.({
			data: JSON.stringify({ tick: { at: Date.now(), ...fields } }),
		});

	it('rewrites the line already in the log, without adding a second one', () => {
		const live = createRoomLive('edits');
		const socket = FakeSocket.last!;
		socket.open();
		tick(socket, {
			chat: [
				{ id: 'm1', from: 'kim', fromId: 'u1', text: 'warmup at 6', at: 1 },
			],
		});
		expect(live.chatLog).toHaveLength(1);

		tick(socket, {
			chatEdits: [{ messageId: 'm1', text: 'warmup at 7', editedAt: 42 }],
		});
		expect(live.chatLog).toHaveLength(1);
		expect(live.chatLog[0]).toMatchObject({
			id: 'm1',
			text: 'warmup at 7',
			editedAt: 42,
		});
	});

	it('leaves every other line alone, id-less ones included', () => {
		const live = createRoomLive('edits-others');
		const socket = FakeSocket.last!;
		socket.open();
		tick(socket, {
			chat: [
				{ id: 'm1', from: 'kim', fromId: 'u1', text: 'first', at: 1 },
				{ from: 'ada', fromId: 'u2', text: 'not saved yet', at: 2 },
			],
		});
		tick(socket, {
			chatEdits: [{ messageId: 'm1', text: 'first, fixed', editedAt: 42 }],
		});
		expect(live.chatLog.map((line) => line.text)).toEqual([
			'first, fixed',
			'not saved yet',
		]);
	});

	it('keeps the marker on a line that was already edited before you joined', () => {
		// The backlog carries the NEW words either way; without editedAt
		// riding along, a rider who arrives later reads a silently rewritten
		// line — which is the one thing editing must not do.
		const live = createRoomLive('edits-seed');
		live.seedChat([
			{
				id: 'm1',
				from: 'kim',
				fromId: 'u1',
				text: 'warmup at 7',
				at: 1,
				editedAt: 42,
			},
		]);
		expect(live.chatLog[0]).toMatchObject({
			text: 'warmup at 7',
			editedAt: 42,
		});
	});

	it('ignores an edit for a line this client never had', () => {
		const live = createRoomLive('edits-unknown');
		const socket = FakeSocket.last!;
		socket.open();
		tick(socket, {
			chat: [{ id: 'm1', from: 'kim', fromId: 'u1', text: 'here', at: 1 }],
		});
		tick(socket, {
			chatEdits: [{ messageId: 'gone', text: 'ghost', editedAt: 42 }],
		});
		expect(live.chatLog).toHaveLength(1);
		expect(live.chatLog[0].text).toBe('here');
	});
});
