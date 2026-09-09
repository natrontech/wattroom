// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RailRoom } from '$lib/room/room-data';

// The endpoint behind every ping. Counting calls IS the assertion: #912 is
// about how many of these one conversation costs.
let fetches = 0;
let world: { rooms: RailRoom[]; maxOwned: number } = { rooms: [], maxOwned: 0 };
vi.mock('$lib/nav/rooms', () => ({
	fetchRailRooms: async () => {
		fetches += 1;
		return world;
	},
}));
const announced: { tag: string; reading: boolean }[] = [];
vi.mock('$lib/messages/announce', () => ({
	announce: (a: { tag: string; reading: boolean }) => announced.push(a),
}));
vi.mock('$lib/notify.svelte', () => ({
	// The real rule (ADR-0042): hidden, or not the front window.
	away: () => document.hidden || !document.hasFocus(),
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
		announced.length = 0;
		document.hasFocus = () => true;
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
		await vi.waitFor(() => expect(announced).toHaveLength(1));
		expect(announced[0]).toMatchObject({ tag: 'chat-velvet', reading: false });
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
