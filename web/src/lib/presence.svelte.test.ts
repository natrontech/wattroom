// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrewRef } from '$lib/crew-types';

// The endpoint behind every ping. Counting calls IS the assertion: #912 is
// about how many of these one conversation costs.
let fetches = 0;
const read: string[] = [];
let world: { crews: CrewRef[]; error?: string } = { crews: [] };
// Reads held open, answered as the world stood when they were asked, so a
// test can land them out of order (#2565).
let hold = false;
const held: (() => void)[] = [];
vi.mock('$lib/api', () => ({
	api: async (path: string) => {
		fetches += 1;
		read.push(path);
		const answer = world.error
			? { ok: false, error: { error: 'internal_error', message: world.error } }
			: { ok: true, data: { crews: world.crews } };
		if (!hold) return answer;
		return new Promise((resolve) => held.push(() => resolve(answer)));
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
// list, so the crews and the dots kept their last values with full confidence.
describe('a feed that stopped answering says so', () => {
	afterEach(() => {
		presence.stop();
		world = { crews: [] };
		hold = false;
		held.length = 0;
	});

	it('reads the crew list', async () => {
		const crew: CrewRef = { id: 'c1', name: 'Velvet Hammer', role: 'owner' };
		world = { crews: [crew] };
		read.length = 0;
		presence.start();
		await vi.waitFor(() => expect(presence.crews).toEqual([crew]));
		expect(read[0]).toBe('/api/crews');
		expect(presence.error).toBe(null);
	});

	it('marks itself stale on the second failed read in a row, not the first', async () => {
		const crew: CrewRef = { id: 'c1', name: 'Velvet Hammer', role: 'owner' };
		world = { crews: [crew] };
		presence.start();
		await vi.waitFor(() => expect(presence.loaded).toBe(true));
		expect(presence.stale).toBe(false);

		// One refusal is a blip the 60 s fallback poll already covers, and the
		// list you had stays on screen.
		world = { crews: [], error: 'The crews could not be loaded.' };
		let seen = fetches;
		presence.reload();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(presence.error).toBe('The crews could not be loaded.');
		expect(presence.crews).toHaveLength(1);
		expect(presence.stale).toBe(false);

		// A second in a row is a feed that has stopped answering.
		seen = fetches;
		presence.reload();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(presence.stale).toBe(true);

		// And one good read clears it — the count is consecutive failures,
		// never a tally of every blip since sign-in.
		world = { crews: [crew] };
		seen = fetches;
		presence.reload();
		await vi.waitFor(() => expect(fetches).toBeGreaterThan(seen));
		expect(presence.stale).toBe(false);
	});

	// A read already on its way when the feed starts refusing lands after the
	// refusals asked later — on a loaded machine the refusals come back first.
	// It answers with the world as it was, and it must not reset the count or
	// put its old list back: the e2e spec lost its mark exactly that way.
	it('never lets an older read land over a newer one (#2565)', async () => {
		const crew: CrewRef = { id: 'c1', name: 'Velvet Hammer', role: 'owner' };
		world = { crews: [crew] };
		presence.start();
		await vi.waitFor(() => expect(presence.loaded).toBe(true));

		hold = true;
		presence.reload(); // the old world, answering late
		world = { crews: [], error: 'The crews could not be loaded.' };
		presence.reload();
		presence.reload();
		expect(held).toHaveLength(3);

		// Two refusals land in the order they were asked: two in a row.
		held[1]();
		held[2]();
		await vi.waitFor(() => expect(presence.stale).toBe(true));

		// Then the old read.
		held[0]();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(presence.stale).toBe(true);
		expect(presence.error).toBe('The crews could not be loaded.');
	});
});
