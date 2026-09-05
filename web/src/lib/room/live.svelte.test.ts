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
