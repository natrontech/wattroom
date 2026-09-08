import { describe, expect, it } from 'vitest';
import { formatWhen } from '$lib/format';
import type { RoomEvent } from '$lib/protocol';
import { eventText, roomTimeline, type TimelineMessage } from './timeline';

const event = (over: Partial<RoomEvent> = {}): RoomEvent => ({
	id: '1',
	kind: 'jukebox',
	verb: 'queued',
	actor: 'Kim',
	track: 'Midnight City',
	count: 1,
	at: 1000,
	...over,
});

const message = (over: Partial<TimelineMessage> = {}): TimelineMessage => ({
	from: 'Ada',
	text: 'warming up',
	at: 1000,
	...over,
});

describe('eventText (#321)', () => {
	it('says who did what to which track', () => {
		expect(eventText(event())).toBe('Kim queued Midnight City');
		expect(eventText(event({ verb: 'skipped' }))).toBe(
			'Kim skipped Midnight City',
		);
		expect(eventText(event({ verb: 'removed' }))).toBe(
			'Kim removed Midnight City',
		);
	});

	it('reads a burst as one line, not eight', () => {
		// The server drops the title when a burst grows: no single track left.
		expect(eventText(event({ count: 8, track: '' }))).toBe(
			'Kim queued 8 tracks',
		);
	});

	it('names who queued whatever reaches the deck', () => {
		expect(
			eventText(event({ verb: 'playing', actor: '', queuedBy: 'Kim' })),
		).toBe('now playing: Midnight City — queued by Kim');
	});

	it('renders nothing for a verb it has never heard of', () => {
		// Vote outcomes land later (#269/#271); an old tab must not print junk.
		expect(eventText(event({ verb: 'voted-out' }))).toBe('');
	});
});

describe('eventText, session lines (#359)', () => {
	const plan = (over: Partial<RoomEvent> = {}) =>
		event({
			kind: 'session',
			verb: 'planned',
			actor: 'Jan',
			track: '',
			subject: 'Sweet Spot 2×20',
			// 2026-09-04T18:30 local, so the rendered time is the machine's.
			when: new Date(2026, 8, 4, 18, 30).getTime(),
			...over,
		});

	it('says who planned what, and when it is for', () => {
		// The app has one wording for a planned moment; the chat line borrows
		// it rather than inventing a second clock format.
		const at = new Date(2026, 8, 4, 18, 30);
		expect(eventText(plan())).toBe(
			`Jan planned Sweet Spot 2×20 for ${formatWhen(at.toISOString(), true)}`,
		);
	});

	it('words moving and cancelling as the plan changing, not a new one', () => {
		expect(eventText(plan({ verb: 'moved' }))).toContain(
			'Jan moved Sweet Spot 2×20 to',
		);
		// Nothing left to be for: a cancelled plan carries no time.
		expect(eventText(plan({ verb: 'cancelled', when: 0 }))).toBe(
			'Jan cancelled Sweet Spot 2×20',
		);
	});

	it('names the workout, not a rider, when the timeline itself moves', () => {
		// Nobody's name: the clock closes a session as readily as a coach.
		expect(eventText(plan({ verb: 'started', actor: '', when: 0 }))).toBe(
			'Sweet Spot 2×20 is starting',
		);
		expect(eventText(plan({ verb: 'ended', actor: '', when: 0 }))).toBe(
			'Sweet Spot 2×20 ended',
		);
	});

	it('renders the client-derived reminder', () => {
		expect(eventText(plan({ verb: 'due', actor: '' }))).toContain(
			'Sweet Spot 2×20 starts at',
		);
	});

	it('survives a line missing the pieces it wants', () => {
		// A newer server could send a plan line this client cannot fill in.
		expect(eventText(plan({ subject: '', when: 0 }))).toBe(
			'Jan planned a session',
		);
	});
});

describe('roomTimeline (#321)', () => {
	it('interleaves events with talking, oldest first', () => {
		const entries = roomTimeline(
			[message({ at: 1000 }), message({ at: 3000, text: 'nice one' })],
			[event({ id: '7', at: 2000 })],
		);
		expect(entries.map((entry) => entry.at)).toEqual([1000, 2000, 3000]);
		expect(entries[1].kind).toBe('event');
		expect(entries[1].key).toBe('e:7');
	});

	it('keeps a line stable when its burst grows', () => {
		// Same id, higher count: the pane replaces the line rather than
		// stacking a second one under it.
		const first = roomTimeline([], [event({ id: '7' })]);
		const grown = roomTimeline([], [event({ id: '7', count: 3, track: '' })]);
		expect(grown[0].key).toBe(first[0].key);
		expect(grown[0].kind === 'event' && eventText(grown[0].event)).toBe(
			'Kim queued 3 tracks',
		);
	});

	it('drops events it cannot word and survives having none', () => {
		expect(
			roomTimeline([message()], [event({ verb: 'shrugged' })]),
		).toHaveLength(1);
		expect(roomTimeline([message()])).toHaveLength(1);
	});
});

// Who came and went (#984, ADR-0022's join/leave shape).
const presence = (over: Partial<RoomEvent> = {}): RoomEvent =>
	event({ kind: 'presence', verb: 'joined', track: '', ...over });

describe('presence lines (#984)', () => {
	it('names one arrival, and counts a burst', () => {
		expect(eventText(presence())).toBe('Kim joined');
		expect(eventText(presence({ count: 2 }))).toBe('Kim and 1 other joined');
		expect(eventText(presence({ count: 3 }))).toBe('Kim and 2 others joined');
	});

	it('says the other three verbs', () => {
		expect(eventText(presence({ verb: 'left' }))).toBe('Kim left');
		expect(eventText(presence({ verb: 'away' }))).toBe('Kim went away');
		expect(eventText(presence({ verb: 'back' }))).toBe('Kim is back');
	});

	// A rider is not told about themselves: they are looking at the room they
	// just walked into, and they pressed the button that says they stepped out.
	it('keeps a rider’s own presence lines off their own timeline', () => {
		const lines = roomTimeline(
			[],
			[
				presence({ id: 'a', actor: 'Kim' }),
				presence({ id: 'b', actor: 'Ada', at: 2000 }),
			],
			'Kim',
		);
		expect(lines).toHaveLength(1);
		expect(lines[0].kind === 'event' && lines[0].event.actor).toBe('Ada');
	});

	it('shows everybody their own view when nobody is named', () => {
		expect(roomTimeline([], [presence(), presence({ id: '2' })])).toHaveLength(
			2,
		);
	});

	// Their own CHAT is still theirs — only presence is filtered.
	it('never hides a rider’s own messages', () => {
		const lines = roomTimeline([message({ from: 'Kim' })], [], 'Kim');
		expect(lines).toHaveLength(1);
	});

	// A tab open since before this shipped renders nothing rather than junk.
	it('renders nothing for a verb it has never heard of', () => {
		expect(eventText(presence({ verb: 'teleported' }))).toBe('');
	});
});

/**
 * Every verb the SERVER can put on the wire has to render to something.
 *
 * `eventText` returns '' for a verb it does not know and `roomTimeline` drops
 * the entry — deliberately, so an old client degrades quietly against a newer
 * server instead of printing junk. The cost is that a verb nobody wrote a case
 * for is indistinguishable from one this client is too old to know: nothing
 * fails, the line simply never appears. That is how `restored` was broadcast
 * to every room and thrown away by every client (#1068).
 *
 * This list is the server's, kept beside `protocol.go`'s RoomEvent comment.
 * Adding a verb there without a case here fails now, rather than going quiet.
 */
const SERVER_VERBS = [
	// jukebox
	'queued',
	'queuedPlaylist',
	'removed',
	'skipped',
	'skippedPlaylist',
	'playing',
	'restored',
	// session
	'planned',
	'moved',
	'cancelled',
	'started',
	'ended',
	// presence
	'joined',
	'left',
	'away',
	'back',
];

describe('every verb the server sends renders', () => {
	it.each(SERVER_VERBS)('%s is not silently dropped', (verb) => {
		const text = eventText(
			event({ kind: 'jukebox', verb, actor: 'Kim', track: 'Sandstorm' }),
		);
		expect(text).not.toBe('');
	});

	it('names who put a track back, and what came back', () => {
		expect(
			eventText(event({ verb: 'restored', actor: 'Kim', track: 'Sandstorm' })),
		).toBe('Kim put Sandstorm back');
	});

	it('still drops a verb this client has never heard of', () => {
		// The quiet degrade is the point — only unknown verbs may use it.
		expect(eventText(event({ verb: 'teleported' }))).toBe('');
	});
});
