// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RailRoom } from '$lib/room/room-data';

// The endpoint behind every ping. Counting calls IS the assertion: #912 is
// about how many of these one conversation costs.
let fetches = 0;
let world: { rooms: RailRoom[]; maxOwned: number; error?: string } = {
	rooms: [],
	maxOwned: 0,
};
vi.mock('$lib/nav/rooms', () => ({
	fetchRailRooms: async () => {
		fetches += 1;
		return world;
	},
}));
// The REAL announce runs here, dedup and all — only its three exits are
// stubbed. #2421 was a dedup that did not hold, and a recorder standing in
// for announce() cannot see that: it records the call, not the decision. The
// cue is also the half of it a rider complained about.
const sounds: string[] = [];
const notified: { tag: string }[] = [];
const toasted: { text: string; href?: string }[] = [];
vi.mock('$lib/sound/cues', () => ({ play: (id: string) => sounds.push(id) }));
vi.mock('$lib/toast.svelte', () => ({
	toasts: {
		push: (text: string, opts?: { href?: string }) =>
			toasted.push({ text, href: opts?.href }),
	},
}));
vi.mock('$lib/notify.svelte', () => ({
	// The real rule (ADR-0042): hidden, or not the front window.
	away: () => document.hidden || !document.hasFocus(),
	notify: {
		push: (_t: string, _b: string, tag: string) => notified.push({ tag }),
	},
}));

// A hand-driven lobby socket, so the test can deliver pings the way the hub
// does: contentless, and as fast as riders type.
let socket: FakeSocket | null = null;
class FakeSocket {
	onopen: (() => void) | null = null;
	onmessage: (() => void) | null = null;
	onclose: (() => void) | null = null;
	readyState = 0;
	constructor() {
		socket = this;
	}
	close() {
		this.readyState = 3;
	}
}
vi.stubGlobal('WebSocket', FakeSocket);

const { presence } = await import('$lib/presence.svelte');

/** One ping from the hub. */
function ping() {
	socket?.onmessage?.();
}

describe('the presence feed coalesces pings', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fetches = 0;
	});
	afterEach(() => {
		presence.stop();
		vi.useRealTimers();
	});

	it('fetches once for a burst, and once more for what the burst changed', () => {
		presence.start();
		// start() fetches the world; the burst is what we are measuring.
		fetches = 0;

		// Ten messages in a fast exchange, well inside one window.
		for (let i = 0; i < 10; i += 1) ping();
		// Leading edge: the first one is not delayed — the badge for the first
		// message of a conversation must not wait.
		expect(fetches).toBe(1);

		// The window closes and the burst is picked up exactly once.
		vi.advanceTimersByTime(250);
		expect(fetches).toBe(2);

		// Nothing further: a settled feed does not keep fetching.
		vi.advanceTimersByTime(1000);
		expect(fetches).toBe(2);
	});

	it('still refreshes promptly for pings spaced further apart', () => {
		presence.start();
		fetches = 0;

		ping();
		expect(fetches).toBe(1);
		vi.advanceTimersByTime(300);
		ping();
		expect(fetches).toBe(2);
		vi.advanceTimersByTime(300);
		ping();
		expect(fetches).toBe(3);
	});

	it('stops fetching once stopped, with a window still open', () => {
		presence.start();
		fetches = 0;

		ping();
		ping(); // arms the trailing fetch
		expect(fetches).toBe(1);
		presence.stop();
		vi.advanceTimersByTime(1000);
		expect(fetches).toBe(1);
	});
});

// A room you are not standing in reaches you the way a DM does (#568). Its
// thread being open counts as reading it only while the window is in front
// (ADR-0042, #1440) — behind another app it must announce like any other.
describe('a room you are not standing in', () => {
	afterEach(() => {
		presence.stop();
		world = { rooms: [], maxOwned: 0 };
		sounds.length = 0;
		notified.length = 0;
		toasted.length = 0;
		document.hasFocus = () => true;
		// The dedup is real localStorage, shared by every test in this file.
		localStorage.clear();
	});

	it('announces its chat into an open thread while the window is not in front', async () => {
		presence.start();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(0)); // the world, not an arrival
		history.pushState({}, '', '/messages/r/velvet');
		document.hasFocus = () => false;
		world = {
			rooms: [
				{
					slug: 'velvet',
					name: 'Velvet Hammer',
					live: false,
					members: 2,
					unread: 1,
					lastChat: { from: 'Ruben', text: 'on my way', at: 1 },
				},
			],
			maxOwned: 0,
		};
		ping();
		await vi.waitFor(() => expect(notified).toHaveLength(1));
		expect(notified[0]).toMatchObject({ tag: 'chat-velvet' });
		expect(sounds).toEqual(['chat']);
	});

	// The first list is the state of the world, and it has to CLAIM the lines
	// it is right not to announce (#2421). Left unclaimed, they were
	// announced by whatever refreshed next — and every presence change
	// refreshes, so a rider joining an unrelated room released yesterday's
	// unread line with a cue and a toast.
	it('claims what the first list does not announce, so a later ping cannot', async () => {
		history.pushState({}, '', '/home');
		world = {
			rooms: [
				{
					slug: 'velvet',
					name: 'Velvet Hammer',
					live: false,
					members: 2,
					unread: 3,
					lastChat: { from: 'Ruben', text: 'said this yesterday', at: 5 },
				},
			],
			maxOwned: 0,
		};
		presence.start();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(0));
		expect(sounds).toHaveLength(0);

		// Somebody joins an unrelated room: a ping, an unchanged world.
		const seen = fetches;
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(sounds).toHaveLength(0);

		// A NEW line in the same room still sounds — the claim is of one
		// millisecond, not of the room.
		world.rooms[0].lastChat = { from: 'Ruben', text: 'on my way', at: 6 };
		ping();
		await vi.waitFor(() => expect(sounds).toEqual(['chat']));
	});

	// The room's own layout re-reads the room off every ping, which marks it
	// read, so `unread` is usually back to zero before this list carries it —
	// usually, because the two answer the same ping and either can be first
	// (#2421). Standing in it is the test that does not depend on the race,
	// the way the session loop already tests it: the in-room path has the
	// line, and in the Chat place it is on the screen being read.
	it('stays quiet about the room you are standing in', async () => {
		presence.start();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(0));
		history.pushState({}, '', '/r/velvet/chat');
		world = {
			rooms: [
				{
					slug: 'velvet',
					name: 'Velvet Hammer',
					live: false,
					members: 2,
					unread: 1,
					lastChat: { from: 'Ruben', text: 'on my way', at: 7 },
				},
			],
			maxOwned: 0,
		};
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(1));
		expect(sounds).toHaveLength(0);

		// Training, mid-ride: still the in-room path's line, not this one's.
		history.pushState({}, '', '/r/velvet/training');
		world.rooms[0].lastChat = { from: 'Ruben', text: 'two to go', at: 8 };
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(2));
		expect(sounds).toHaveLength(0);

		// Away from it, the same line reaches you as a DM would.
		history.pushState({}, '', '/workouts');
		world.rooms[0].lastChat = { from: 'Ruben', text: 'last one', at: 9 };
		ping();
		await vi.waitFor(() => expect(sounds).toEqual(['chat']));
		expect(toasted[0].href).toBe('/messages/r/velvet');
	});

	// A session starting there is the one event nobody wants to miss
	// (ADR-0042, #1910): announced on the flip to live, once, and only to a
	// rider who is not standing in the room — the in-room path has them.
	it('announces a session starting, once, unless you are standing in it', async () => {
		presence.start();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(0));
		history.pushState({}, '', '/home');
		const velvet = (live: boolean) => ({
			slug: 'velvet',
			name: 'Velvet Hammer',
			live,
			members: 2,
			session: live ? { workoutName: 'Openers', elapsedSec: 3 } : undefined,
		});
		world = { rooms: [velvet(false)], maxOwned: 0 };
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(1));
		world = { rooms: [velvet(true)], maxOwned: 0 };
		ping();
		await vi.waitFor(() => expect(toasted).toHaveLength(1));
		expect(toasted[0].href).toBe('/r/velvet/training');
		// Still live on the next list: old news.
		const seen = fetches;
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(toasted).toHaveLength(1);

		// Standing in the room, the in-room path announces; this one is quiet.
		toasted.length = 0;
		sounds.length = 0;
		world = { rooms: [velvet(false)], maxOwned: 0 };
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen + 1));
		history.pushState({}, '', '/r/velvet/chat');
		world = { rooms: [velvet(true)], maxOwned: 0 };
		ping();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen + 2));
		expect(toasted).toHaveLength(0);
		expect(sounds).toHaveLength(0);
	});
});

// The feed survives its socket (#1742): a drop re-dials with a jittered
// backoff and refreshes on the reopen, and a tab that comes back re-fetches
// and re-dials at once instead of drawing a frozen feed with confidence.
describe('the presence feed survives its socket (#1742)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fetches = 0;
	});
	afterEach(() => {
		presence.stop();
		vi.useRealTimers();
	});

	it('re-dials after a drop, and refreshes on the reopen', () => {
		presence.start();
		const first = socket!;
		fetches = 0;
		first.onclose?.();
		// The backoff holds the dial: two seconds at most, jittered by half.
		expect(socket).toBe(first);
		vi.advanceTimersByTime(3_100);
		expect(socket).not.toBe(first);
		socket!.onopen?.();
		expect(fetches).toBe(1);
	});

	it('re-fetches and re-dials when the tab becomes visible', () => {
		presence.start();
		fetches = 0;
		// A zombie: the socket is dead and the browser never said so.
		socket!.close();
		const dead = socket!;
		document.dispatchEvent(new Event('visibilitychange'));
		expect(fetches).toBe(1);
		expect(socket).not.toBe(dead);
	});
});

// The sidebar used to go stale in silence (#1743). A dead socket is not that
// case — the tests above bound it — but a read that keeps failing with a list
// already on screen is: `Sidebar.svelte` draws its error only over an EMPTY
// list, so the rooms and the dots kept their last values with full confidence.
describe('a feed that stopped answering says so', () => {
	afterEach(() => {
		presence.stop();
		world = { rooms: [], maxOwned: 0 };
	});

	it('marks itself stale on the second failed read in a row, not the first', async () => {
		const room: RailRoom = {
			slug: 'velvet',
			name: 'Velvet Hammer',
			live: false,
			members: 2,
		};
		world = { rooms: [room], maxOwned: 0 };
		presence.start();
		await vi.waitFor(() => expect(presence.loaded).toBe(true));
		expect(presence.stale).toBe(false);

		// One refusal is a blip the 60 s fallback poll already covers, and the
		// list you had stays on screen.
		world = { rooms: [], maxOwned: 0, error: 'The rooms could not be loaded.' };
		let seen = fetches;
		presence.reload();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(presence.error).toBe('The rooms could not be loaded.');
		expect(presence.rooms).toHaveLength(1);
		expect(presence.stale).toBe(false);

		// A second in a row is a feed that has stopped answering.
		seen = fetches;
		presence.reload();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(presence.stale).toBe(true);

		// And one good read clears it — the count is consecutive failures,
		// never a tally of every blip since sign-in.
		world = { rooms: [room], maxOwned: 0 };
		seen = fetches;
		presence.reload();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(presence.stale).toBe(false);
	});
});
