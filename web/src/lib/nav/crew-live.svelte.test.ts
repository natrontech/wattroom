// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveChannel, LiveCrew } from '$lib/crews-live';

// The crew read (#2444), answered by hand. Counting reads keeps the waits
// honest: an assertion of silence is only worth something after the read.
let reads = 0;
let world: LiveCrew[] = [];
vi.mock('$lib/crews-live', () => ({
	fetchCrewsLive: async () => {
		reads += 1;
		return { ok: true, data: { crews: structuredClone(world) } };
	},
}));
vi.mock('$lib/account.svelte', () => ({ account: { me: { id: 'me' } } }));
let connected: string | undefined;
vi.mock('$lib/room/connection.svelte', () => ({
	roomConnection: {
		get current() {
			return connected ? { address: { channel: connected } } : null;
		},
	},
}));
// The REAL announce runs here, dedup and all — only its three exits are
// stubbed. #2421 was a dedup that did not hold, and a recorder standing in
// for announce() cannot see that: it records the call, not the decision. The
// cue is also the half of it a rider complained about.
const sounds: string[] = [];
const notified: { tag: string; href?: string }[] = [];
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
		push: (_t: string, _b: string, tag: string, opts?: { href?: string }) =>
			notified.push({ tag, href: opts?.href }),
	},
}));

const { crewLive } = await import('./crew-live.svelte');

async function read() {
	const before = reads;
	await crewLive.reload();
	expect(reads).toBe(before + 1);
}

const text = (line?: LiveChannel['last']): LiveChannel => ({
	id: 'general',
	kind: 'text',
	name: 'general',
	unread: line ? 1 : 0,
	last: line,
});
const voice = (running: boolean): LiveChannel => ({
	id: 'cave',
	kind: 'voice',
	name: 'Pain Cave',
	session: running
		? {
				id: 's1',
				channel: 'cave',
				workout: 'Openers',
				phase: 'running',
				elapsed: 3,
				coach: 'ruben',
				coachName: 'Ruben',
				riders: ['Ruben'],
				riderIds: ['ruben'],
			}
		: undefined,
});
const crew = (...channels: LiveChannel[]): LiveCrew[] => [
	{ id: 'thu', name: 'Thursday Crew', role: 'member', channels },
];
const line = (text: string, at: number, fromId = 'ruben') => ({
	from: 'Ruben',
	fromId,
	text,
	at,
});

// What happens in a crew reaches you the way a DM does (#568, #1910) — now
// from the crew read, landing on the channel or the session (#2457). A
// thread open in front of you counts as reading it only while the window is
// in front (ADR-0042, #1440).
describe('what the crew read announces', () => {
	afterEach(() => {
		crewLive.reset();
		world = [];
		connected = undefined;
		sounds.length = 0;
		notified.length = 0;
		toasted.length = 0;
		document.hasFocus = () => true;
		// The dedup is real localStorage, shared by every test in this file.
		localStorage.clear();
	});

	it('announces a line into an open channel while the window is not in front', async () => {
		await read(); // the world, not an arrival
		history.pushState({}, '', '/crew/thu/c/general');
		document.hasFocus = () => false;
		world = crew(text(line('on my way', 1)));
		await read();
		expect(notified).toEqual([
			{ tag: 'chat-c:general', href: '/crew/thu/c/general' },
		]);
		expect(sounds).toEqual(['chat']);
	});

	// The first read is the state of the world, and it has to CLAIM the lines
	// it is right not to announce (#2421). Left unclaimed, they were announced
	// by whatever read next — and every presence change reads, so a rider
	// joining an unrelated channel released yesterday's unread line with a
	// cue and a toast.
	it('claims what the first read does not announce, so a later read cannot', async () => {
		history.pushState({}, '', '/home');
		world = crew(text(line('said this yesterday', 5)));
		await read();
		expect(sounds).toHaveLength(0);

		// Somebody joins an unrelated channel: a read, an unchanged world.
		await read();
		expect(sounds).toHaveLength(0);

		// A NEW line in the same channel still sounds — the claim is of one
		// millisecond, not of the channel.
		world = crew(text(line('on my way', 6)));
		await read();
		expect(sounds).toEqual(['chat']);
		expect(toasted[0].href).toBe('/crew/thu/c/general');
	});

	it('says nothing about your own line, or a channel read in front of you', async () => {
		await read();
		history.pushState({}, '', '/home');
		world = crew(text(line('I said this', 7, 'me')));
		await read();
		expect(sounds).toHaveLength(0);

		history.pushState({}, '', '/crew/thu/c/general');
		world = crew(text(line('on screen', 8)));
		await read();
		expect(sounds).toHaveLength(0);
	});

	// A session starting is the one event nobody wants to miss (ADR-0042,
	// #1910): announced on the read it first appears in, once, and a click
	// opens the session (#2457). Standing in its voice channel, or holding
	// the connection to it, the in-channel path announces it instead.
	it('announces a session starting, once, unless you are in its channel', async () => {
		await read();
		history.pushState({}, '', '/home');
		world = crew(voice(false));
		await read();
		world = crew(voice(true));
		await read();
		expect(toasted).toHaveLength(1);
		expect(toasted[0].href).toBe('/crew/thu/s/s1');
		// Still running on the next read: old news.
		await read();
		expect(toasted).toHaveLength(1);

		for (const standing of [
			() => history.pushState({}, '', '/crew/thu/v/cave'),
			() => history.pushState({}, '', '/crew/thu/s/s1'),
			() => {
				history.pushState({}, '', '/home');
				connected = 'cave';
			},
		]) {
			toasted.length = 0;
			sounds.length = 0;
			connected = undefined;
			localStorage.clear();
			world = crew(voice(false));
			await read();
			standing();
			world = crew(voice(true));
			await read();
			expect(toasted).toHaveLength(0);
			expect(sounds).toHaveLength(0);
		}
	});
});
