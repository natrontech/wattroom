// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrewRef } from '#lib/crew-types.ts';

// The endpoint behind every ping. Counting calls IS the assertion: #912 is
// about how many of these one conversation costs.
let fetches = 0;
const read: string[] = [];
let world: { crews: CrewRef[]; error?: string } = { crews: [] };
// Reads held open, answered as the world stood when they were asked, so a
// test can land them out of order (#2565).
let hold = false;
const held: (() => void)[] = [];
vi.mock('#lib/api.ts', () => ({
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

const { presence } = await import('#lib/presence.svelte.ts');

/**
 * Lets start()'s reads land and its window close. A read asked while one is
 * in flight waits for it, and starting opens the ping window (#4565), so a
 * test that counts reads puts both behind it first.
 */
const landed = () => vi.advanceTimersByTimeAsync(300);

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

	it('fetches once for a burst, and once more for what the burst changed', async () => {
		presence.start();
		// start() fetches the world; the burst is what we are measuring.
		await landed();
		fetches = 0;

		// Ten messages in a fast exchange, well inside one window.
		for (let i = 0; i < 10; i += 1) ping();
		// Leading edge: the first one is not delayed — the badge for the first
		// message of a conversation must not wait.
		expect(fetches).toBe(1);

		// The window closes and the burst is picked up exactly once.
		await vi.advanceTimersByTimeAsync(250);
		expect(fetches).toBe(2);

		// Nothing further: a settled feed does not keep fetching.
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetches).toBe(2);
	});

	it('still refreshes promptly for pings spaced further apart', async () => {
		presence.start();
		await landed();
		fetches = 0;

		ping();
		expect(fetches).toBe(1);
		await vi.advanceTimersByTimeAsync(300);
		ping();
		expect(fetches).toBe(2);
		await vi.advanceTimersByTimeAsync(300);
		ping();
		expect(fetches).toBe(3);
	});

	it('stops fetching once stopped, with a window still open', async () => {
		presence.start();
		await landed();
		fetches = 0;

		ping();
		ping(); // arms the trailing fetch
		expect(fetches).toBe(1);
		presence.stop();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetches).toBe(1);
	});

	// Starting, the socket opening and the hub's ping for your own arrival
	// come within a few ms: three reads, each bumping `version`, which every
	// follower re-reads on (#4565).
	it('reads twice for its own start: once, and once more for what came during it', async () => {
		presence.start();
		socket!.onopen?.();
		ping();
		expect(fetches).toBe(1);
		await landed();
		// The one more began after the open and the ping, when the window
		// closed: it has what they were about.
		expect(fetches).toBe(2);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fetches).toBe(2);
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

	it('re-dials at once after a drop, and refreshes on the reopen', async () => {
		presence.start();
		const first = socket!;
		await landed();
		fetches = 0;
		first.onclose?.();
		expect(socket).not.toBe(first);
		socket!.onopen?.();
		expect(fetches).toBe(1);
	});

	it('holds the second dial a second or so, jittered', () => {
		presence.start();
		const first = socket!;
		first.onclose?.();
		const second = socket!;
		second.onclose?.(); // the redial failed too
		expect(socket).toBe(second);
		vi.advanceTimersByTime(1_250);
		expect(socket).not.toBe(second);
	});

	it('re-fetches and re-dials when the tab becomes visible', async () => {
		presence.start();
		await landed();
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

	// A read already on its way when the feed starts refusing answers with
	// the world as it was. Reads no longer overlap (#4565): the ones asked
	// meanwhile are one read, begun after it lands, so the old answer cannot
	// come back last, reset the count or put its list back (#2565).
	it('never lets an older read land over a newer one (#2565)', async () => {
		const crew: CrewRef = { id: 'c1', name: 'Velvet Hammer', role: 'owner' };
		world = { crews: [crew] };
		presence.start();
		await vi.waitFor(() => expect(presence.loaded).toBe(true));
		await new Promise((resolve) => setTimeout(resolve, 0));

		hold = true;
		presence.reload(); // the old world, answering late
		world = { crews: [], error: 'The crews could not be loaded.' };
		presence.reload();
		presence.reload();
		// Two asks during the read: neither started one beside it.
		expect(held).toHaveLength(1);

		held[0]();
		await vi.waitFor(() => expect(held).toHaveLength(2));
		expect(presence.error).toBe(null);
		// The one read for both began after them, and has the refusal.
		held[1]();
		await vi.waitFor(() =>
			expect(presence.error).toBe('The crews could not be loaded.'),
		);
		expect(presence.crews).toHaveLength(1);
		expect(held).toHaveLength(2);
	});
});
