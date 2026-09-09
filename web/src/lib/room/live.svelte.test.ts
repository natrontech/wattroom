// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buffered = vi.hoisted(() => ({
	rows: [] as { watts: number }[],
	since: [] as number[],
}));
vi.mock('$lib/ride/buffer', () => ({
	openRideBuffer: async () => ({
		append(row: { watts: number }) {
			buffered.rows.push(row);
		},
		end() {},
		since: async (seq: number) => {
			buffered.since.push(seq);
			return [];
		},
	}),
}));
vi.mock('$lib/account.svelte', () => ({ account: { me: { id: 'u1' } } }));

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

const { createRoomLive, SETTLED_ATTEMPTS } = await import('./live.svelte');

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

describe('room live ride buffer', () => {
	it('buffers one row a second however fast the trainer notifies (audit 2026-09-09)', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		buffered.rows.length = 0;
		const live = createRoomLive('buffer');
		await vi.advanceTimersByTimeAsync(0);
		live.sendMetrics({ watts: 200 });
		live.sendMetrics({ watts: 210 });
		await vi.advanceTimersByTimeAsync(500);
		live.sendMetrics({ watts: 220 });
		await vi.advanceTimersByTimeAsync(500);
		live.sendMetrics({ watts: 230 });
		expect(buffered.rows.map((r) => r.watts)).toEqual([200, 230]);
		vi.useRealTimers();
	});

	it('replays from the last seq the hub said it received, not the last one stamped (#1467)', async () => {
		vi.useFakeTimers();
		buffered.since.length = 0;
		const live = createRoomLive('floor');
		await vi.advanceTimersByTimeAsync(0);
		const socket = FakeSocket.last!;
		socket.open();
		for (let i = 0; i < 5; i++) live.sendMetrics({ watts: 200 });
		// The hub's last word before the drop: it has seq 3.
		socket.onmessage?.({
			data: JSON.stringify({
				tick: { at: Date.now(), riders: { u1: { watts: 200, seq: 3 } } },
			}),
		});
		// Stamped and "sent" into a pipe that never drained.
		live.sendMetrics({ watts: 200 });
		socket.close();
		socket.onclose?.();
		await vi.advanceTimersByTimeAsync(2_500);
		FakeSocket.last!.open();
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.since).toEqual([3]);
		vi.useRealTimers();
	});
});

describe('room live lost (#1500)', () => {
	beforeEach(() => {
		FakeSocket.last = null;
		vi.useFakeTimers();
	});

	/** One failed reconnect: the dialled socket closes without opening. */
	async function drop() {
		const socket = FakeSocket.last!;
		socket.close();
		socket.onclose?.();
		await vi.advanceTimersByTimeAsync(10_000);
	}

	it('turns to lost once the backoff has settled, and only then', async () => {
		const live = createRoomLive('lost');
		await vi.advanceTimersByTimeAsync(0);
		FakeSocket.last!.open();
		expect(live.lost).toBe(false);
		for (let i = 1; i < SETTLED_ATTEMPTS; i++) {
			await drop();
			expect(live.status).toBe('reconnecting');
			expect(live.lost).toBe(false);
		}
		await drop();
		expect(live.lost).toBe(true);
		// Back: the reading clears with the status, and the count starts over.
		FakeSocket.last!.open();
		expect(live.lost).toBe(false);
		expect(live.status).toBe('live');
		vi.useRealTimers();
	});

	it('spends 1, 2, 4, 8 s before settling at 10 s, as the spec says', async () => {
		createRoomLive('backoff');
		await vi.advanceTimersByTimeAsync(0);
		FakeSocket.last!.open();
		const dials: number[] = [];
		for (const wait of [1_000, 2_000, 4_000, 8_000, 10_000]) {
			const socket = FakeSocket.last!;
			socket.close();
			socket.onclose?.();
			await vi.advanceTimersByTimeAsync(wait - 1);
			expect(FakeSocket.last).toBe(socket);
			await vi.advanceTimersByTimeAsync(1);
			expect(FakeSocket.last).not.toBe(socket);
			dials.push(wait);
		}
		expect(dials).toHaveLength(5);
		vi.useRealTimers();
	});

	it('retry() dials now instead of waiting out the backoff', async () => {
		const live = createRoomLive('retry');
		await vi.advanceTimersByTimeAsync(0);
		FakeSocket.last!.open();
		for (let i = 0; i < SETTLED_ATTEMPTS; i++) await drop();
		const waiting = FakeSocket.last!;
		waiting.close();
		waiting.onclose?.();
		// The backoff is at its 10 s ceiling; the button does not wait for it.
		live.retry();
		expect(FakeSocket.last).not.toBe(waiting);
		// And the timer it cancelled dials nothing on top of the new socket.
		const dialled = FakeSocket.last;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(FakeSocket.last).toBe(dialled);
		vi.useRealTimers();
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

	it('takes an edit it missed while the socket was down (#1082)', () => {
		// The edit fan-out is ephemeral: it rides one tick and is never
		// re-sent. A rider whose socket flapped across that tick never saw it,
		// and the reconnect reseed is the only thing that can still tell them.
		// It could not, because the seed skips every line it already holds —
		// so the stale words stayed on screen until a full page reload.
		const live = createRoomLive('edits-missed');
		live.seedChat([
			{ id: 'm1', from: 'kim', fromId: 'u1', text: 'warmup at 7', at: 1 },
		]);
		expect(live.chatLog[0]).toMatchObject({ text: 'warmup at 7' });

		// Reconnect: the backlog is read again, and it carries the edit that
		// was made while this client was away.
		live.seedChat([
			{
				id: 'm1',
				from: 'kim',
				fromId: 'u1',
				text: 'warmup at 8',
				at: 1,
				editedAt: 99,
			},
		]);
		expect(live.chatLog).toHaveLength(1);
		expect(live.chatLog[0]).toMatchObject({
			text: 'warmup at 8',
			editedAt: 99,
		});
	});

	it('does not let a stale backlog undo an edit that just arrived', () => {
		// The other half of audit #219's race: a live edit can land while the
		// backlog fetch is still in flight, so the seed resolves holding OLDER
		// words. editedAt is the version — the newer edit wins, whichever way
		// it arrived, or a reconnect would silently roll a line back.
		const live = createRoomLive('edits-race');
		live.seedChat([
			{
				id: 'm1',
				from: 'kim',
				fromId: 'u1',
				text: 'warmup at 8',
				at: 1,
				editedAt: 99,
			},
		]);
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
			text: 'warmup at 8',
			editedAt: 99,
		});
	});

	// The save runs off the read loop, so a line's id follows in a later tick
	// — and an author can hit edit inside that gap. The edit names an id the
	// other riders' copies do not carry yet; dropped, it never comes back
	// until a reload (#1231's shape). Held, it lands the moment the id does.
	it('holds an edit that arrives before the line has its id, and applies it when it lands', () => {
		const live = createRoomLive('edits-early');
		const socket = FakeSocket.last!;
		socket.open();
		tick(socket, {
			chat: [{ from: 'kim', fromId: 'u1', text: 'warmup at 6', at: 1 }],
		});
		tick(socket, {
			chatEdits: [{ messageId: 'm1', text: 'warmup at 7', editedAt: 42 }],
		});
		expect(live.chatLog[0].text).toBe('warmup at 6');
		tick(socket, { chatIds: [{ fromId: 'u1', at: 1, id: 'm1' }] });
		expect(live.chatLog).toHaveLength(1);
		expect(live.chatLog[0]).toMatchObject({
			id: 'm1',
			text: 'warmup at 7',
			editedAt: 42,
		});
	});

	// The #1231 flake, as the trace of #1229's failed run showed it: the
	// join-time backlog already carries the line with its id, then the tick
	// delivers the same line id-less with its id beside it. One line, once —
	// or the edit lands on the copy the keyed list does not draw.
	it('holds a line once when the backlog seeded it and the tick repeats it id-less', () => {
		const live = createRoomLive('edits-seeded-then-tick');
		const socket = FakeSocket.last!;
		socket.open();
		live.seedChat([
			{ id: 'm1', from: 'kim', fromId: 'u1', text: 'warmup at 6', at: 1 },
		]);
		tick(socket, {
			chat: [{ from: 'kim', fromId: 'u1', text: 'warmup at 6', at: 1 }],
			chatIds: [{ fromId: 'u1', at: 1, id: 'm1' }],
		});
		expect(live.chatLog).toHaveLength(1);
		tick(socket, {
			chatEdits: [{ messageId: 'm1', text: 'warmup at 7', editedAt: 42 }],
		});
		expect(live.chatLog).toEqual([
			expect.objectContaining({ id: 'm1', text: 'warmup at 7', editedAt: 42 }),
		]);
	});

	it('holds a line once when the tick brought it id-less and the backlog then names it', () => {
		const live = createRoomLive('edits-tick-then-seeded');
		const socket = FakeSocket.last!;
		socket.open();
		tick(socket, {
			chat: [{ from: 'kim', fromId: 'u1', text: 'warmup at 6', at: 1 }],
		});
		live.seedChat([
			{ id: 'm1', from: 'kim', fromId: 'u1', text: 'warmup at 6', at: 1 },
		]);
		tick(socket, { chatIds: [{ fromId: 'u1', at: 1, id: 'm1' }] });
		expect(live.chatLog).toHaveLength(1);
		tick(socket, {
			chatEdits: [{ messageId: 'm1', text: 'warmup at 7', editedAt: 42 }],
		});
		expect(live.chatLog).toEqual([
			expect.objectContaining({ id: 'm1', text: 'warmup at 7', editedAt: 42 }),
		]);
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
