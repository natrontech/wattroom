// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

/**
 * #1128, in its own file on purpose.
 *
 * This is the one test that needs `account.me` to be somebody, so the away
 * effect can find that rider in the roster. Mocking the account store inside
 * `connection.svelte.test.ts` reached every test in that file and broke two
 * of them on CI while passing locally — and mocking it by spreading the real
 * module was worse, because the real store then ran and six tests hung for
 * seconds each. A file of its own is the cheap answer: the mock reaches only
 * the test that wants it.
 */
vi.mock('$lib/api', () => ({ api: async () => ({ ok: false }) }));
vi.mock('$lib/sound/cues', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sound/cues')>()),
	play: () => {},
}));
vi.mock('$lib/notify.svelte', () => ({ notify: { push: () => {} } }));
vi.mock('$lib/account.svelte', () => ({
	account: { me: { id: 'me', displayName: 'Me' } },
}));

let fakeTick = $state<unknown>(null);
const fakeLive = {
	get tick() {
		return fakeTick;
	},
	sent: [] as unknown[],
	sendMetrics() {},
	finish() {},
	close() {},
	status: 'live',
	chatLog: [],
	roomEvents: [],
	pushEvent() {},
	chatReactions: {},
	myReacts: {},
	refusal: null,
	claims: [] as unknown[],
	pairing: {},
	claimSensors() {},
	seedChat() {},
	chat() {},
	react() {},
	jukebox() {},
	control() {},
	cheer() {},
	aways: [] as boolean[],
	setAway(next: boolean) {
		this.aways.push(next);
	},
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

const { roomConnection } = await import('$lib/room/connection.svelte');

/**
 * Effects, then the async work they start. `av.setAway` awaits the mic and
 * the camera, so a single `tick()` returns before the state it sets has
 * landed — and a test that reads too early passes or fails on how fast the
 * machine is, which is exactly what "green locally, red on CI" means.
 */
async function settle() {
	await tick();
	await Promise.resolve();
	await tick();
}

const roster = (away: boolean) => ({
	// `state` as well as the roster: another effect reads
	// `live.tick.state.phase` every tick, and a fixture without it throws
	// past the assertions rather than failing them.
	state: { phase: 'idle' },
	roster: [{ id: 'me', displayName: 'Me', away }],
});

describe('away, against the tick that was already in flight', () => {
	// Pressing Away is optimistic — local first, message second — so the tick
	// ALREADY IN FLIGHT still carries away:false. Applying it ran the
	// come-back branch a fifth of a second later: the mix unmuted and the mic
	// re-opened itself, and the button read as doing nothing while the room
	// went on hearing the rider.
	it('holds the press, then believes the roster again', async () => {
		const connection = roomConnection.join('lounge');
		try {
			fakeTick = roster(false);
			await settle();
			expect(connection.av.away).toBe(false);

			connection.setAway(true);
			await settle();
			expect(connection.av.away).toBe(true);
			expect(fakeLive.aways.at(-1)).toBe(true);

			// The echo of the state we just left. It must change nothing —
			// twice, because a slow round trip is several ticks, not one.
			fakeTick = roster(false);
			await settle();
			expect(connection.av.away).toBe(true);
			fakeTick = roster(false);
			await settle();
			expect(connection.av.away).toBe(true);

			// The server catches up.
			fakeTick = roster(true);
			await settle();
			expect(connection.av.away).toBe(true);

			// …and now the roster is believed again, which is the whole reason
			// this effect exists (#807): away pressed on the rider's phone has
			// to reach this screen. Ignoring the roster forever would have
			// fixed the bug by removing the feature.
			fakeTick = roster(false);
			await settle();
			expect(connection.av.away).toBe(false);
		} finally {
			roomConnection.leave();
			fakeTick = null;
		}
	});

	// The bound. A message the server never received must not pin this screen
	// to a wish forever — after enough disagreeing ticks the roster wins, and
	// that is also how a dropped socket heals on reconnect.
	//
	// Counted in TICKS rather than milliseconds on purpose: a wall clock
	// measures how busy the machine is. A five-second version of this window
	// expired inside a single run on a loaded CI box while passing locally
	// three times, which is a bound that means two different things.
	it('gives up waiting after enough ticks disagree', async () => {
		const connection = roomConnection.join('lounge');
		try {
			fakeTick = roster(false);
			await settle();

			// The press is never echoed — the message went nowhere.
			connection.setAway(true);
			await settle();
			expect(connection.av.away).toBe(true);

			// It holds for more than a tick or two — the whole point is
			// surviving a slow round trip.
			for (let i = 0; i < 2; i++) {
				fakeTick = roster(false);
				await settle();
				expect(connection.av.away).toBe(true);
			}
			// …and it does give up, rather than pinning this screen forever.
			// The exact tick it gives up on is a tuning number and not what
			// this asserts: `settle()` lets the effect run more than once, so
			// counting them here would be measuring the harness.
			let gaveUp = false;
			for (let i = 0; i < 12 && !gaveUp; i++) {
				fakeTick = roster(false);
				await settle();
				gaveUp = connection.av.away === false;
			}
			expect(gaveUp).toBe(true);
		} finally {
			roomConnection.leave();
			fakeTick = null;
		}
	});
});
