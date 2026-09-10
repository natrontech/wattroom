// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { RiderMetrics } from '$lib/protocol';
import type { Trainer, TrainerSample, TrainerStatus } from '$lib/ble/trainer';
import { SPRINT_LEAD_SECONDS } from '$lib/workout/sprint-window.svelte';

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
	private statusListener: ((s: TrainerStatus) => void) | null = null;
	onStatus(cb: (s: TrainerStatus) => void) {
		this.statusListener = cb;
		return () => (this.statusListener = null);
	}
	/** The link dropping and coming back, as the driver reports it. */
	blip() {
		this.status = 'connecting';
		this.statusListener?.('connecting');
		this.status = 'connected';
		this.statusListener?.('connected');
	}
	/**
	 * One ~1 Hz reading, as the BLE layer would deliver it — a second apart,
	 * under fake timers too: the guards count seconds (#1798), and three
	 * readings stamped with one frozen Date.now() are one second, not three.
	 */
	#at = 0;
	pedal(watts: number, cadence = 90) {
		this.#at = Math.max(this.#at + 1000, Date.now());
		this.listener?.({ watts, cadence, at: this.#at });
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

describe('the personal guards in a group ride (#788)', () => {
	const settle = async () => {
		await Promise.resolve();
		flushSync();
	};

	/** A room mid-interval: the shared timeline is running and asks for 200 W. */
	function inASession() {
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
			shared: () => ({ phase: 'running', elapsed: 10 }),
			segments: () => [
				{
					kind: 'steady' as const,
					startSeconds: 0,
					seconds: 600,
					fromFraction: 1,
					toFraction: 1,
					stepPath: [0],
				},
			],
		};
		return { live, socket, deps };
	}

	it('knows its own reading, for the equipment screen (#1799)', async () => {
		const { deps } = inASession();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();
		expect(ride.reading).toBeUndefined();
		trainer.pedal(210, 88);
		await settle();
		expect(ride.reading).toBe('210 W · 88 rpm');
		ride.unpair();
		expect(ride.reading).toBeUndefined();
		dispose();
	});

	// A reattach mid-block re-asserts the target (#1846): the driver re-took
	// control, the target had not changed, and the effect had nothing to
	// say — the trainer held no ERG for the rest of the block.
	it('says the target again when the link comes back', async () => {
		vi.useFakeTimers();
		const { deps } = inASession();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();
		expect(ride.target).toBe(200);
		const before = trainer.commands.length;
		trainer.blip();
		await settle();
		expect(trainer.commands.slice(before)).toEqual(['erg:200']);
		dispose();
		vi.useRealTimers();
	});

	it('releases the target when the rider stops, leaving the room clock alone', async () => {
		vi.useFakeTimers();
		const { live, deps } = inASession();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();
		expect(ride.target).toBe(200);

		for (let i = 0; i < 3; i++) trainer.pedal(0, 0);
		await settle();
		expect(ride.guard).toBe('autopaused');
		expect(ride.target).toBe(0);
		expect(trainer.commands.at(-1)).toBe('erg:0');
		// The room's own timeline is untouched: the shared session still says
		// running, and this rider's guard is nobody else's business.
		expect(deps.shared().phase).toBe('running');

		// Pedalling again starts the countdown, not a snap back to target.
		trainer.pedal(180);
		await settle();
		expect(ride.guard).toBe('resuming');
		expect(ride.guardResumeIn).toBe(3);
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(ride.guard).toBe('running');
		expect(ride.target).toBe(200);

		dispose();
		live.close();
		vi.useRealTimers();
	});

	it('releases the target when cadence collapses under it', async () => {
		vi.useFakeTimers();
		const { live, deps } = inASession();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();

		// Five seconds grinding at 40 rpm against a 200 W target.
		for (let i = 0; i < 5; i++) trainer.pedal(120, 40);
		await settle();
		expect(ride.target).toBe(0);
		expect(trainer.commands.at(-1)).toBe('erg:0');

		dispose();
		live.close();
		vi.useRealTimers();
	});

	it('leaves a rider resting between sessions alone', async () => {
		// Nothing is being asked of them, so there is nothing to release — and
		// "Paused — you stopped pedalling" over a room with no session running
		// is noise, not status.
		vi.useFakeTimers();
		const { live, deps } = inASession();
		deps.shared = () => ({ phase: 'idle', elapsed: 0 });
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();

		for (let i = 0; i < 10; i++) trainer.pedal(0, 0);
		await settle();
		expect(ride.guard).toBe('running');

		dispose();
		live.close();
		vi.useRealTimers();
	});

	it('still hands a sprint to a rider the guard had paused', async () => {
		// The guards infer that the rider left; the klaxon is an announced
		// event they are about to answer. A rider sitting at zero when it
		// sounds would otherwise never be given the hill.
		vi.useFakeTimers();
		const { live, socket, deps } = inASession();
		deps.profile.current.singleSpeed = true;
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();

		for (let i = 0; i < 3; i++) trainer.pedal(0, 0);
		await settle();
		expect(ride.guard).toBe('autopaused');

		const at = Date.now();
		socket.onmessage!({
			data: JSON.stringify({
				tick: { at, sprint: { startsAtMs: at, endsAtMs: at + 10_000 } },
			}),
		});
		await settle();
		expect(trainer.commands.at(-1)).toBe('erg:400');

		dispose();
		live.close();
		vi.useRealTimers();
	});
});

describe("a workout's own sprint block (#2014)", () => {
	/** Svelte settles its effects on a microtask; flushSync alone does not. */
	const settle = async () => {
		await Promise.resolve();
		flushSync();
	};

	afterEach(() => {
		vi.useRealTimers();
	});

	// 60 s at 60 %, then the sprint, then 60 % again — the shape of every
	// workout the report came off.
	const segments = [
		{
			kind: 'steady' as const,
			startSeconds: 0,
			seconds: 60,
			fromFraction: 0.6,
			toFraction: 0.6,
			stepPath: [0],
		},
		{
			kind: 'sprint' as const,
			startSeconds: 60,
			seconds: 15,
			stepPath: [1],
		},
		{
			kind: 'steady' as const,
			startSeconds: 75,
			seconds: 60,
			fromFraction: 0.6,
			toFraction: 0.6,
			stepPath: [2],
		},
	];

	/**
	 * A room ride whose shared clock the test moves. The clock is $state
	 * because that is what the room's own is: a tick moves it and everything
	 * downstream recomputes.
	 */
	function riding() {
		const live = createRoomLive('mfw');
		let elapsed = $state(0);
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
			shared: () => ({ phase: 'running', elapsed }),
			segments: () => segments,
		};
		return {
			live,
			deps,
			seek(to: number) {
				elapsed = to;
			},
		};
	}

	// `targetAt` has no target for a sprint block, and the room folded that
	// null into 0 — which in ERG is a freewheel, not a sprint. The rider
	// pedalled against nothing for the whole block and reported exactly that.
	it('flips to slope rather than writing ERG 0', async () => {
		vi.useFakeTimers();
		const { live, deps, seek } = riding();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		const trainer = new FakeTrainer();
		await ride.ride(trainer);
		await settle();
		expect(trainer.commands.at(-1)).toBe('erg:120');

		trainer.commands.length = 0;
		seek(61);
		await settle();
		// Flat first, then the hill 500 ms later — an FTMS trainer has to be
		// taken out of ERG before the grade lands.
		expect(trainer.commands).toEqual(['sim:0']);
		vi.advanceTimersByTime(500);
		expect(trainer.commands).toEqual(['sim:0', 'sim:5']);
		expect(trainer.commands).not.toContain('erg:0');

		// And back onto the target the block after it asks for.
		seek(80);
		await settle();
		expect(trainer.commands.at(-1)).toBe('erg:120');

		dispose();
		live.close();
	});

	it('counts the block in on the room screen', async () => {
		const { live, deps, seek } = riding();
		let ride!: ReturnType<typeof createRide>;
		const dispose = $effect.root(() => {
			ride = createRide(deps);
		});
		await settle();
		expect(ride.blockSprint).toBe(null);

		// Inside the klaxon lead: the window opens so SprintMoment and the
		// cue have something to count down, exactly as a coach's does.
		seek(60 - SPRINT_LEAD_SECONDS);
		await settle();
		const window = ride.blockSprint;
		expect(window).not.toBe(null);
		expect(window!.endsAtMs - window!.startsAtMs).toBe(15_000);

		seek(80);
		await settle();
		expect(ride.blockSprint).toBe(null);

		dispose();
		live.close();
	});
});
