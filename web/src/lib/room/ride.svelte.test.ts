// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { RiderMetrics } from '$lib/protocol';
import type { Trainer, TrainerSample, TrainerStatus } from '$lib/ble/trainer';

// The socket's own dependencies, silenced: IndexedDB, and the module the
// tick's clock window lives in stays real (it only does arithmetic).
vi.mock('$lib/ride/buffer', () => ({
	openRideBuffer: async () => ({
		append() {},
		end() {},
		since: async () => [],
	}),
}));

/** A room socket, opened but never dialled. */
class FakeSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static last: FakeSocket | null = null;
	readyState = FakeSocket.OPEN;
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
}
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

const { createRoomLive } = await import('./live.svelte');
const { createRide } = await import('./ride.svelte');

/** A trainer that is only ever asked to hand over samples. */
class FakeTrainer implements Trainer {
	status: TrainerStatus = 'connected';
	mode = 'erg' as const;
	private listener: ((sample: TrainerSample) => void) | null = null;
	constructor(readonly name = 'Kickr') {}
	async connect() {}
	async disconnect() {}
	/** Every actuator command, in order — what the sprint effect is judged on. */
	commands: string[] = [];
	async setTargetPower(watts: number) {
		this.commands.push(`erg:${watts}`);
	}
	async setSimulation(grade: number) {
		this.commands.push(`sim:${grade}`);
	}
	onSample(cb: (sample: TrainerSample) => void) {
		this.listener = cb;
		return () => (this.listener = null);
	}
	onStatus() {
		return () => {};
	}
	/** One ~1 Hz reading, as the BLE layer would deliver it. */
	pedal(watts: number) {
		this.listener?.({ watts, cadence: 90, at: Date.now() });
	}
}

function seqsSentOn(socket: FakeSocket): number[] {
	return socket.sent
		.map((line) => JSON.parse(line) as { metrics?: RiderMetrics })
		.flatMap((message) => (message.metrics ? [message.metrics.seq] : []));
}

describe('the seq stream (#522)', () => {
	// The server dedupes the ride record by seq for the whole session, so a
	// counter that restarts inside one session makes every sample after the
	// restart collide with one already recorded and vanish. The live tiles
	// never consult the record, which is why this read as half working: the
	// numbers moved, the saved ride kept nothing. The seq belongs to the
	// socket session, so nothing shorter-lived can restart it.
	it('carries on across a rebuilt ride', async () => {
		const live = createRoomLive('mfw');
		const socket = FakeSocket.last!;
		const deps = {
			live,
			profile: {
				current: {
					ftp: 200,
					shareHr: true,
					singleSpeed: false,
					sprintGrade: 5,
				},
			},
			recording: { record() {} } as never,
			myId: () => 'me',
			shared: () => undefined,
			segments: () => [],
		};

		let first!: ReturnType<typeof createRide>;
		const disposeFirst = $effect.root(() => {
			first = createRide(deps);
		});
		const one = new FakeTrainer('first');
		await first.ride(one);
		one.pedal(180);
		one.pedal(185);
		first.unpair();
		disposeFirst();

		let second!: ReturnType<typeof createRide>;
		const disposeSecond = $effect.root(() => {
			second = createRide(deps);
		});
		const two = new FakeTrainer('second');
		await second.ride(two);
		two.pedal(190);
		two.pedal(195);
		disposeSecond();

		expect(seqsSentOn(socket)).toEqual([1, 2, 3, 4]);
		live.close();
	});
});

describe('a sprint the ticks stop under (#789)', () => {
	/** Svelte settles its effects on a microtask; flushSync alone does not. */
	const settle = async () => {
		await Promise.resolve();
		flushSync();
	};

	afterEach(() => {
		vi.useRealTimers();
	});

	function rider() {
		const live = createRoomLive('mfw');
		const socket = FakeSocket.last!;
		const deps = {
			live,
			profile: {
				current: {
					ftp: 200,
					shareHr: true,
					// The single-speed command is the loud one: 2xFTP held
					// against a rider who cannot shift out of it.
					singleSpeed: true,
					sprintGrade: 5,
				},
			},
			recording: { record() {} } as never,
			myId: () => 'me',
			shared: () => undefined,
			segments: () => [],
		};
		return { live, socket, deps };
	}

	/** One tick carrying a sprint window that opens now and runs 10 s. */
	function sprintTick(socket: FakeSocket, at: number) {
		socket.onmessage!({
			data: JSON.stringify({
				tick: { at, sprint: { startsAtMs: at, endsAtMs: at + 10_000 } },
			}),
		});
	}

	it('releases the sprint command when its window passes', async () => {
		vi.useFakeTimers();
		const { live, socket, deps } = rider();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();

		sprintTick(socket, Date.now());
		await settle();
		expect(trainer.commands.at(-1)).toBe('erg:400');

		// The socket drops here: no further ticks, so the last one's `at` sits
		// inside the window forever. The window still has to end.
		await vi.advanceTimersByTimeAsync(11_000);
		await settle();
		expect(trainer.commands.at(-1)).toBe('erg:0');

		dispose();
		live.close();
	});

	it('holds the sprint for as long as the window actually runs', async () => {
		vi.useFakeTimers();
		const { live, socket, deps } = rider();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();

		sprintTick(socket, Date.now());
		await settle();
		await vi.advanceTimersByTimeAsync(5_000);
		await settle();
		expect(trainer.commands.at(-1)).toBe('erg:400');

		dispose();
		live.close();
	});
});
