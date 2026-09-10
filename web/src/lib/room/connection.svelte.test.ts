// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { Trainer, TrainerStatus } from '$lib/ble/trainer';

vi.mock('$lib/api', () => ({ api: async () => ({ ok: false }) }));
// Spread the real module: the mixer imports more of it than the connection
// does, and only the two calls that would make noise need silencing.
const played: string[] = [];
vi.mock('$lib/sound/cues', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sound/cues')>()),
	play: (id: string) => played.push(id),
}));
vi.mock('$lib/notify.svelte', () => ({
	notify: { push: () => {} },
	// The real rule (ADR-0042): hidden, or not the front window.
	away: () => document.hidden || !document.hasFocus(),
}));
// A hand-driven socket: the tick is what the ride and the room both read,
// and the test needs to move it. $state, so a derived that fails to track it
// is caught rather than papered over by lazy first evaluation.
let fakeTick = $state<unknown>(null);
let fakeChat = $state<unknown[]>([]);
const fakeLive = {
	get tick() {
		return fakeTick;
	},
	sent: [] as { seq: number }[],
	sendMetrics(m: { seq: number }) {
		this.sent.push(m);
	},
	finish() {},
	close() {},
	status: 'live',
	get chatLog() {
		return fakeChat;
	},
	roomEvents: [],
	pushEvent() {},
	chatReactions: {},
	myReacts: {},
	refusal: null,
	// The connection claims this tab's sensors whenever the set changes
	// (#610); recorded so a test can assert what the hub would be told.
	claims: [] as { held: string[] }[],
	pairing: {},
	claimSensors(claim: { held: string[] }) {
		this.claims.push(claim);
	},
	seedChat() {},
	chat() {},
	react() {},
	jukebox() {},
	control() {},
	cheer() {},
};
vi.mock('$lib/room/live.svelte', () => ({ createRoomLive: () => fakeLive }));
vi.mock('livekit-client', () => ({
	Room: class {
		remoteParticipants = new Map();
		on() {
			return this;
		}
		async connect() {}
		disconnect() {}
	},
	RoomEvent: new Proxy({}, { get: (_, key) => key }),
	Track: { Source: new Proxy({}, { get: (_, key) => key }) },
}));

import { prepareRoomAv, roomConnection } from '$lib/room/connection.svelte';
import { toasts } from '$lib/toast.svelte';

// The room layout's load does this before the shell joins (#1514).
await prepareRoomAv();

class FakeTrainer implements Trainer {
	name = 'Fake';
	status: TrainerStatus = 'disconnected';
	mode = 'erg' as const;
	targets: number[] = [];
	disconnected = false;
	connects = 0;
	async connect() {
		this.connects++;
		this.status = 'connected';
	}
	async disconnect() {
		this.disconnected = true;
	}
	async setTargetPower(watts: number) {
		this.targets.push(watts);
	}
	async setSimulation() {}
	onSample() {
		return () => {};
	}
	onStatus() {
		return () => {};
	}
}

/**
 * #521/#522: the trainer is a property of standing in the room, so it hangs
 * off the connection — not off whichever page happens to be rendering it.
 * A per-page ride disconnected the trainer on the way to /workouts and reset
 * the metrics seq, which the server's ride record then dropped as duplicates.
 */
describe('roomConnection', () => {
	afterEach(() => {
		roomConnection.leave();
		// The tick is module state: a roster left behind here is the next
		// test's opening observation.
		fakeTick = null;
		fakeChat = [];
		document.hasFocus = () => true;
	});

	it('keeps one ride and one recording across repeated joins', () => {
		const first = roomConnection.join('lounge');
		const again = roomConnection.join('lounge');
		expect(again).toBe(first);
		expect(again.ride).toBe(first.ride);
		expect(again.recording).toBe(first.recording);
	});

	it('releases the trainer when you leave, not when a page unmounts', async () => {
		const connection = roomConnection.join('lounge');
		const trainer = new FakeTrainer();
		await connection.ride.ride(trainer);
		expect(connection.ride.trainer).toBe(trainer);

		roomConnection.leave();
		expect(trainer.disconnected).toBe(true);
		// Never left holding resistance on a trainer nobody is riding.
		expect(trainer.targets.at(-1)).toBe(0);

		// A fresh join is a fresh ride — a different room is a different session.
		expect(roomConnection.join('lounge').ride).not.toBe(connection.ride);
	});

	// #850, a rider report: they clicked through Home and settings, dropped out
	// of the room, and heard nothing. A rider three metres from the screen
	// learns about a state change by ear or not at all (ux.md), and losing the
	// room takes the socket, the voice channel and the trainer with it.
	it('says so out loud when the room ends under the rider', () => {
		played.length = 0;
		roomConnection.join('lounge');

		roomConnection.leave('signedOut');

		expect(played).toContain('leave');
		expect(toasts.items.at(-1)?.text).toContain('lounge');
		// The way back in, on the toast itself.
		expect(toasts.items.at(-1)?.href).toBe('/r/lounge');
	});

	// Their own Leave needs no announcement: they just pressed it.
	it('goes quietly when the rider is the one leaving', () => {
		played.length = 0;
		const before = toasts.items.length;
		roomConnection.join('lounge');

		roomConnection.leave();

		expect(played).not.toContain('leave');
		expect(toasts.items).toHaveLength(before);
	});

	it('takes a trainer handed over live without connecting it again', async () => {
		// #1851: the solo slot's trainer walks into the room as it is.
		const connection = roomConnection.join('lounge');
		const trainer = new FakeTrainer();
		trainer.status = 'connected';
		await connection.ride.ride(trainer);
		expect(connection.ride.trainer).toBe(trainer);
		expect(trainer.connects).toBe(0);
	});

	it('calls a paired trainer silent on the local second, without a server tick', async () => {
		// #1852: judged off the tick, losing the socket froze the check.
		vi.useFakeTimers();
		try {
			const connection = roomConnection.join('lounge');
			await connection.ride.ride(new FakeTrainer());
			flushSync();
			expect(connection.ride.fault).toBeNull();
			vi.advanceTimersByTime(11_000);
			flushSync();
			expect(connection.ride.fault).toBe('silent');
		} finally {
			vi.useRealTimers();
		}
	});

	it('claims the trainer for this tab, and releases it on unpair', async () => {
		// The claim is what stops a second screen pairing the same trainer and
		// feeding a second stream of watts into one ride record (#610).
		fakeLive.claims = [];
		const connection = roomConnection.join('lounge');
		await connection.ride.ride(new FakeTrainer());
		await tick();
		expect(fakeLive.claims.at(-1)?.held).toContain('trainer');

		connection.ride.unpair();
		await tick();
		expect(fakeLive.claims.at(-1)?.held).not.toContain('trainer');
	});

	// Every tick carries one; the roster is what these two are about.
	const idle = { phase: 'idle', elapsed: 0 };

	// #906: an away rider stays in the roster, so the membership cues never
	// fire and a room can empty to one in silence.
	it('sounds the pair when a rider steps out and comes back', async () => {
		roomConnection.join('lounge');
		fakeTick = { state: idle, roster: [{ id: 'bob', name: 'Bob' }] };
		await tick();
		played.length = 0;

		fakeTick = {
			state: idle,
			roster: [{ id: 'bob', name: 'Bob', away: true }],
		};
		await tick();
		expect(played).toEqual(['leave']);

		fakeTick = {
			state: idle,
			roster: [{ id: 'bob', name: 'Bob', away: false }],
		};
		await tick();
		expect(played).toEqual(['leave', 'join']);
	});

	// ADR-0042: "not looking" is hidden OR not the front window. A chat panel
	// left open while the rider is in another app must announce like any
	// other (#1440) — it used to count as read in front of them.
	it('announces chat into an open panel while the window is not in front', async () => {
		const conn = roomConnection.join('lounge');
		conn.readingChat(true);
		document.hasFocus = () => false;
		await tick();
		played.length = 0;

		const at = Date.now() + 1000;
		fakeChat = [{ from: 'Bob', fromId: 'bob', text: 'still there?', at }];
		await tick();
		expect(played).toEqual(['chat']);

		// In front again: the open panel speaks for itself.
		document.hasFocus = () => true;
		fakeChat = [
			...fakeChat,
			{ from: 'Bob', fromId: 'bob', text: 'hello?', at: at + 1 },
		];
		await tick();
		expect(played).toEqual(['chat']);
	});

	// Arriving is the join cue's own event — a rider walking in is not a
	// rider coming back, and must not sound twice.
	it('does not hear an arrival as a return', async () => {
		roomConnection.join('lounge');
		fakeTick = { state: idle, roster: [{ id: 'bob', name: 'Bob' }] };
		await tick();
		played.length = 0;

		fakeTick = {
			state: idle,
			roster: [
				{ id: 'bob', name: 'Bob' },
				{ id: 'ann', name: 'Ann' },
			],
		};
		await tick();
		expect(played).toEqual(['join']);
	});
});

/**
 * The same lesson av.svelte.test.ts records for screenshares (#173/#284), for
 * the ride: a value derived in a page's scope freezes at its last reading the
 * moment that page unmounts. The session and its workout drive the trainer's
 * targets, so they belong to the connection's scope, not to whichever room
 * page happened to open it.
 */
describe('the connection keeps deriving the session after a page dies', () => {
	afterEach(() => roomConnection.leave());

	it('still follows the tick once the opening scope is disposed', () => {
		let connection!: ReturnType<typeof roomConnection.join>;
		const dispose = $effect.root(() => {
			connection = roomConnection.join('lounge');
		});
		dispose();

		// Read before the change, so a derived that caches instead of tracking
		// fails here rather than passing on its first lazy evaluation.
		expect(connection.shared()).toBeUndefined();

		fakeTick = {
			state: {
				phase: 'running',
				elapsed: 12,
				workoutJson: JSON.stringify({
					name: 'Threshold',
					steps: [{ type: 'steady', seconds: 300, target: 0.95 }],
				}),
			},
		};
		expect(connection.shared()?.phase).toBe('running');
		expect(connection.segments()).toHaveLength(1);
		expect(connection.workout()?.name).toBe('Threshold');
	});
});
