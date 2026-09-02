// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Trainer, TrainerStatus } from '$lib/ble/trainer';

vi.mock('$lib/api', () => ({ api: async () => ({ ok: false }) }));
// Spread the real module: the mixer imports more of it than the connection
// does, and only the two calls that would make noise need silencing.
vi.mock('$lib/sound/cues', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sound/cues')>()),
	play: () => {},
	setDucked: () => {},
}));
vi.mock('$lib/notify.svelte', () => ({ notify: { push: () => {} } }));
// A hand-driven socket: the tick is what the ride and the room both read,
// and the test needs to move it. $state, so a derived that fails to track it
// is caught rather than papered over by lazy first evaluation.
let fakeTick = $state<unknown>(null);
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
	chatLog: [],
	roomEvents: [],
	chatReactions: {},
	myReacts: {},
	refusal: null,
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

import { roomConnection } from '$lib/room/connection.svelte';

class FakeTrainer implements Trainer {
	name = 'Fake';
	status: TrainerStatus = 'disconnected';
	mode = 'erg' as const;
	targets: number[] = [];
	disconnected = false;
	async connect() {
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
	afterEach(() => roomConnection.leave());

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
