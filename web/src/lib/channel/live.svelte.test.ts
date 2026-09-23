import { channelAddress } from '$lib/channel/address';
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buffered = vi.hoisted(() => ({
	rows: [] as { watts: number }[],
	since: [] as number[],
	/** What since() hands back: the rows the hub never acknowledged. */
	tail: [] as { watts: number }[],
	opened: [] as { workoutName: string; startedAt: number }[],
	ended: 0,
	// Whether the store opens at all — the test flips it to stand for a
	// private window or blocked site data (#1466 finding 4).
	crashSafe: true,
}));
vi.mock('$lib/ride/buffer', () => ({
	MIN_SAMPLES: 60,
	openRideBuffer: async (meta: { workoutName: string; startedAt: number }) => {
		buffered.opened.push(meta);
		return {
			crashSafe: buffered.crashSafe,
			append(row: { watts: number }) {
				buffered.rows.push(row);
			},
			end() {
				buffered.ended++;
			},
			since: async (seq: number) => {
				buffered.since.push(seq);
				return buffered.tail;
			},
		};
	},
}));
vi.mock('$lib/account.svelte', () => ({ account: { me: { id: 'u1' } } }));

/** A channel socket that is dialled but never answers until the test says so. */
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

const { createChannelLive, SETTLED_ATTEMPTS, SILENCE_MS } =
	await import('./live.svelte');

const QUEUE = 16;

/** A tick that says the timeline is running — what opens the ride buffer. */
function running(socket: FakeSocket, elapsed = 5, workoutName = 'Openers') {
	socket.onmessage?.({
		data: JSON.stringify({
			tick: {
				at: Date.now(),
				state: { phase: 'running', elapsed, workoutName },
			},
		}),
	});
}

describe('channel live workout definition', () => {
	beforeEach(() => {
		FakeSocket.last = null;
	});

	// #1710: the server sends the JSON on the tick that changes it and names
	// it by hash on every other; the store fills it back in from the last one
	// heard, so the session's parsed workout never blinks.
	it('fills the workout back in from the last tick that carried it', () => {
		const live = createChannelLive(channelAddress('c', 'lean', 'lean'));
		const socket = FakeSocket.last!;
		socket.open();
		const say = (state: Record<string, unknown>) =>
			socket.onmessage?.({
				data: JSON.stringify({ tick: { at: Date.now(), state } }),
			});
		say({ phase: 'idle', workoutHash: 'h1', workoutJson: '{"steps":[]}' });
		expect(live.tick?.state.workoutJson).toBe('{"steps":[]}');
		say({ phase: 'idle', workoutHash: 'h1' });
		expect(live.tick?.state.workoutJson).toBe('{"steps":[]}');
		// A new pick arrives in full, and is what later ticks fill in.
		say({ phase: 'idle', workoutHash: 'h2', workoutJson: '{"steps":[1]}' });
		say({ phase: 'countdown', workoutHash: 'h2' });
		expect(live.tick?.state.workoutJson).toBe('{"steps":[1]}');
		// No workout, no definition.
		say({ phase: 'idle' });
		expect(live.tick?.state.workoutJson).toBeUndefined();
	});
});

describe('channel live send while reconnecting', () => {
	beforeEach(() => {
		FakeSocket.last = null;
	});

	it('queues commands until the socket opens, then flushes them in order', () => {
		const live = createChannelLive(channelAddress('c', 'flush', 'flush'));
		const socket = FakeSocket.last!;
		live.cheer('one');
		live.cheer('two');
		expect(socket.sent).toEqual([]);
		socket.open();
		const cheers = socket.sent.map((raw) => JSON.parse(raw).cheer?.emoji);
		expect(cheers.slice(0, 2)).toEqual(['one', 'two']);
	});

	it('holds no more than the bound while the wire is down', () => {
		const live = createChannelLive(channelAddress('c', 'full', 'full'));
		const socket = FakeSocket.last!;
		for (let i = 0; i < QUEUE + 1; i++) live.cheer(`c${i}`);
		socket.open();
		const cheers = socket.sent
			.map((raw) => JSON.parse(raw).cheer?.emoji)
			.filter(Boolean);
		expect(cheers).toHaveLength(QUEUE);
		expect(cheers).not.toContain(`c${QUEUE}`);
		// The wire is back: the next one goes straight out.
		live.cheer('after');
		expect(JSON.parse(socket.sent.at(-1)!).cheer.emoji).toBe('after');
	});

	it('drops metrics without queueing — stale watts help nobody', () => {
		const live = createChannelLive(channelAddress('c', 'metrics', 'metrics'));
		const socket = FakeSocket.last!;
		live.sendMetrics({ watts: 200, cadence: 90 });
		socket.open();
		expect(socket.sent.some((raw) => 'metrics' in JSON.parse(raw))).toBe(false);
	});

	it('keeps jukebox refusals separate for the add surface', () => {
		const live = createChannelLive(
			channelAddress('c', 'jukebox-refusal', 'jukebox-refusal'),
		);
		const socket = FakeSocket.last!;
		socket.open();
		socket.onmessage?.({
			data: JSON.stringify({
				error: {
					code: 'jukebox_validation_error',
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

describe('channel live ride buffer', () => {
	it('buffers one row a second however fast the trainer notifies (audit 2026-09-09)', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000_000);
		buffered.rows.length = 0;
		const live = createChannelLive(channelAddress('c', 'buffer', 'buffer'));
		FakeSocket.last!.open();
		running(FakeSocket.last!);
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
		const live = createChannelLive(channelAddress('c', 'floor', 'floor'));
		const socket = FakeSocket.last!;
		socket.open();
		running(socket);
		await vi.advanceTimersByTimeAsync(0);
		for (let i = 0; i < 5; i++) live.sendMetrics({ watts: 200 });
		// The hub's last word before the drop: it has seq 3.
		socket.onmessage?.({
			data: JSON.stringify({
				tick: {
					at: Date.now(),
					state: { phase: 'running', elapsed: 6 },
					riders: { u1: { watts: 200, seq: 3 } },
				},
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

describe('channel live ride buffer follows the session (#1541)', () => {
	beforeEach(() => {
		FakeSocket.last = null;
		buffered.opened.length = 0;
		buffered.rows.length = 0;
		buffered.tail.length = 0;
		buffered.ended = 0;
		buffered.crashSafe = true;
		vi.useFakeTimers();
		vi.setSystemTime(2_000_000);
	});

	const phase = (socket: FakeSocket, phase: string, seq?: number) =>
		socket.onmessage?.({
			data: JSON.stringify({
				tick: {
					at: Date.now(),
					state: { phase, elapsed: 0 },
					riders: seq === undefined ? undefined : { u1: { seq } },
				},
			}),
		});

	it('opens no buffer in the lounge, one per session, ended when it closes', async () => {
		const live = createChannelLive(channelAddress('c', 'follow', 'follow'));
		const socket = FakeSocket.last!;
		socket.open();
		phase(socket, 'idle');
		await vi.advanceTimersByTimeAsync(0);
		live.sendMetrics({ watts: 150 });
		expect(buffered.opened).toEqual([]);
		expect(buffered.rows).toEqual([]);

		running(socket, 5, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.opened).toEqual([
			// Named and dated by the tick, not the join: the recovered .fit
			// is what these become.
			expect.objectContaining({
				workoutName: 'Openers',
				startedAt: 2_000_000 - 5_000,
			}),
		]);
		live.sendMetrics({ watts: 200 });
		expect(buffered.rows).toHaveLength(1);

		phase(socket, 'done');
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.ended).toBe(1);
		// The next session gets its own.
		running(socket, 0, 'Main set');
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.opened).toHaveLength(2);
		vi.useRealTimers();
	});

	// #1466 finding 4: the buffer degrades to a working-looking object whose
	// append is a no-op, which is right mid-ride and wrong at the open — a
	// ride with no crash safety at all used to look exactly like one with it.
	it('says so when nothing is writing the ride down (#1466 finding 4)', async () => {
		buffered.crashSafe = false;
		const live = createChannelLive(channelAddress('c', 'nostore', 'nostore'));
		const socket = FakeSocket.last!;
		socket.open();
		expect(live.noCrashSafety).toBe(false);

		running(socket, 5, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		expect(live.noCrashSafety).toBe(true);

		// It is about the ride being recorded, so it goes when the session
		// does — a lounge is not a place with a ride to lose.
		phase(socket, 'done');
		await vi.advanceTimersByTimeAsync(0);
		expect(live.noCrashSafety).toBe(false);

		// And a store that opens says nothing at all.
		buffered.crashSafe = true;
		running(socket, 0, 'Main set');
		await vi.advanceTimersByTimeAsync(0);
		expect(live.noCrashSafety).toBe(false);
		vi.useRealTimers();
	});

	it('keeps the buffer unfinished when the hub never heard a minute of it (#1536)', async () => {
		const live = createChannelLive(channelAddress('c', 'tail', 'tail'));
		const socket = FakeSocket.last!;
		socket.open();
		running(socket, 5, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		for (let i = 0; i < 70; i++) live.sendMetrics({ watts: 200 });
		// The hub acknowledged nothing past the tenth sample; the rest is the
		// tail a dropped socket replayed into a session that had already saved.
		buffered.tail = Array.from({ length: 60 }, () => ({ watts: 200 }));
		phase(socket, 'done', 10);
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.since).toContain(10);
		expect(buffered.ended).toBe(0);

		// Under a minute unheard is the last second of a clean close, not a
		// lost ride: the buffer ends as before.
		buffered.tail = [{ watts: 200 }];
		running(socket, 0, 'Main set');
		await vi.advanceTimersByTimeAsync(0);
		live.sendMetrics({ watts: 210 });
		phase(socket, 'done', 70);
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.ended).toBe(1);
		vi.useRealTimers();
	});

	// A server that restarts mid-session comes back with no session at all:
	// the phase goes from running straight to idle, never through done. The
	// hub's per-rider ack says it HEARD the samples, never that it saved
	// them, and a fresh process acks the live stream while holding nothing
	// to save — so the empty tail used to stamp the last copy finished
	// (#1466, ADR-0052).
	it('keeps the ride, and says so, when the server comes back without the session (#1466)', async () => {
		const live = createChannelLive(channelAddress('c', 'restart', 'restart'));
		const socket = FakeSocket.last!;
		socket.open();
		running(socket, 5, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		for (let i = 0; i < 70; i++) {
			live.sendMetrics({ watts: 200 });
			// The hub ticks every second; a socket left silent for 70 s is
			// one the store rightly gives up on (#2135).
			running(socket, 5 + i, 'Openers');
			await vi.advanceTimersByTimeAsync(1000);
		}
		expect(buffered.rows).toHaveLength(70);
		buffered.tail = [];
		phase(socket, 'idle', 70);
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.ended).toBe(0);
		expect(live.lostSession).toEqual({ workoutName: 'Openers', minutes: 1 });
		// The next session clears the status; /ride's recovery card still
		// holds the ride.
		running(socket, 0, 'Main set');
		await vi.advanceTimersByTimeAsync(0);
		expect(live.lostSession).toBeNull();
		vi.useRealTimers();
	});

	// A socket that missed the closing tick comes back to an idle channel too —
	// but one that can still name its workout, because a session that closed
	// keeps it and a new pick replaces it. The hub saved that ride; saying
	// the server lost it would be a lie.
	it('does not blame the server for an idle channel that still names its workout', async () => {
		const live = createChannelLive(
			channelAddress('c', 'reconnected', 'reconnected'),
		);
		const socket = FakeSocket.last!;
		socket.open();
		running(socket, 5, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		for (let i = 0; i < 70; i++) {
			live.sendMetrics({ watts: 200 });
			// The hub ticks every second; a socket left silent for 70 s is
			// one the store rightly gives up on (#2135).
			running(socket, 5 + i, 'Openers');
			await vi.advanceTimersByTimeAsync(1000);
		}
		socket.onmessage?.({
			data: JSON.stringify({
				tick: {
					at: Date.now(),
					state: { phase: 'idle', elapsed: 0, workoutName: 'Openers' },
					riders: { u1: { seq: 70 } },
				},
			}),
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(live.lostSession).toBeNull();
		vi.useRealTimers();
	});

	// The same restart, to someone watching from a phone: nothing of theirs
	// was recording, so there is nothing to recover and nothing to say.
	it('says nothing about a lost session to a rider who buffered nothing', async () => {
		const live = createChannelLive(
			channelAddress('c', 'spectator', 'spectator'),
		);
		const socket = FakeSocket.last!;
		socket.open();
		running(socket, 5, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		phase(socket, 'idle', 0);
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.ended).toBe(0);
		expect(live.lostSession).toBeNull();
		vi.useRealTimers();
	});

	it('opens one on a reload mid-session too', async () => {
		createChannelLive(channelAddress('c', 'reload', 'reload'));
		const socket = FakeSocket.last!;
		socket.open();
		running(socket, 600, 'Openers');
		await vi.advanceTimersByTimeAsync(0);
		expect(buffered.opened[0]?.startedAt).toBe(2_000_000 - 600_000);
		vi.useRealTimers();
	});
});

describe('channel live lost (#1500)', () => {
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
		const live = createChannelLive(channelAddress('c', 'lost', 'lost'));
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
		createChannelLive(channelAddress('c', 'backoff', 'backoff'));
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
		const live = createChannelLive(channelAddress('c', 'retry', 'retry'));
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

describe('channel live silence and offline (#2135, #2121)', () => {
	let online = true;
	beforeEach(() => {
		FakeSocket.last = null;
		online = true;
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			get: () => online,
		});
		vi.useFakeTimers();
	});

	const tick = (socket: FakeSocket) =>
		socket.onmessage?.({ data: JSON.stringify({ tick: { at: Date.now() } }) });

	// The report: wifi swapped for ethernet under an open socket. The browser
	// kept it OPEN with nothing arriving, the hub dropped the rider, and the
	// tab said live until a refresh.
	it('drops a socket that stays open but stops hearing ticks', async () => {
		const live = createChannelLive(channelAddress('c', 'silent', 'silent'));
		const socket = FakeSocket.last!;
		socket.open();
		tick(socket);
		await vi.advanceTimersByTimeAsync(SILENCE_MS - 1);
		expect(live.status).toBe('live');
		await vi.advanceTimersByTimeAsync(1);
		expect(live.status).toBe('reconnecting');
		expect(socket.readyState).toBe(FakeSocket.CLOSED);
		// Through the ordinary backoff, without waiting for an onclose a dead
		// path may not deliver for minutes.
		await vi.advanceTimersByTimeAsync(1_000);
		expect(FakeSocket.last).not.toBe(socket);
		// The abandoned socket's close arrives late, after its replacement is
		// already live, and must not report that replacement as dropped.
		FakeSocket.last!.open();
		socket.onclose?.();
		expect(live.status).toBe('live');
		vi.useRealTimers();
	});

	it('keeps a socket that goes on hearing ticks', async () => {
		const live = createChannelLive(channelAddress('c', 'ticking', 'ticking'));
		const socket = FakeSocket.last!;
		socket.open();
		for (let second = 0; second < 30; second++) {
			tick(socket);
			await vi.advanceTimersByTimeAsync(1_000);
		}
		expect(live.status).toBe('live');
		expect(FakeSocket.last).toBe(socket);
		vi.useRealTimers();
	});

	it('says offline when the device is, and dials the moment it is back', async () => {
		const live = createChannelLive(channelAddress('c', 'offline', 'offline'));
		const socket = FakeSocket.last!;
		socket.open();
		online = false;
		window.dispatchEvent(new Event('offline'));
		expect(live.status).toBe('offline');
		expect(live.lost).toBe(false);
		const waiting = FakeSocket.last;
		online = true;
		window.dispatchEvent(new Event('online'));
		// Not the backoff's timer: the network is back now.
		expect(FakeSocket.last).not.toBe(waiting);
		FakeSocket.last!.open();
		expect(live.status).toBe('live');
		vi.useRealTimers();
	});
});
