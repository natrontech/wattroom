import { describe, expect, it } from 'vitest';
import { formatWhen } from '$lib/format';
import type { ChannelEvent } from '$lib/protocol';
import { dmArrivalEvent } from '$lib/channel/dm-line';
import { eventText } from './events';

const event = (over: Partial<ChannelEvent> = {}): ChannelEvent => ({
	id: '1',
	kind: 'jukebox',
	verb: 'queued',
	actor: 'Kim',
	track: 'Midnight City',
	count: 1,
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
	const plan = (over: Partial<ChannelEvent> = {}) =>
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

	// The due line was derived from the room's upcoming list, which went with
	// M9; the voice channel's plan card says it now (#2606).
	it('draws nothing for the retired due line', () => {
		expect(eventText(plan({ verb: 'due', actor: '' }))).toBe('');
	});

	it('survives a line missing the pieces it wants', () => {
		// A newer server could send a plan line this client cannot fill in.
		expect(eventText(plan({ subject: '', when: 0 }))).toBe(
			'Jan planned a session',
		);
	});
});

// Who came and went (#984, ADR-0022's join/leave shape).
const presence = (over: Partial<ChannelEvent> = {}): ChannelEvent =>
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

	// A tab open since before this shipped renders nothing rather than junk.
	it('renders nothing for a verb it has never heard of', () => {
		expect(eventText(presence({ verb: 'teleported' }))).toBe('');
	});
});

/**
 * Every verb the SERVER can put on the wire has to render to something.
 *
 * `eventText` returns '' for a verb it does not know and the lounge drops
 * the line — deliberately, so an old client degrades quietly against a newer
 * server instead of printing junk. The cost is that a verb nobody wrote a case
 * for is indistinguishable from one this client is too old to know: nothing
 * fails, the line simply never appears. That is how `restored` was broadcast
 * to everyone and thrown away by every client (#1068).
 *
 * This list is the server's, kept beside `protocol.go`'s ChannelEvent comment.
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

	it("names who won which game, with the mode's label (#1575)", () => {
		expect(
			eventText({
				id: 'g1',
				kind: 'session',
				verb: 'won',
				actor: 'Ada',
				subject: 'watt-golf',
				count: 1,
				at: 0,
			} as never),
		).toBe('Ada won Watt Golf');
	});

	it('names a game that ended with nobody to name (#2235)', () => {
		// A collective ramp ends on the group's average falling off the line, so
		// it builds no podium — and used to leave the timeline silent about a
		// game the whole group had just ridden.
		expect(
			eventText({
				id: 'g2',
				kind: 'session',
				verb: 'gameEnded',
				subject: 'collective-ramp',
				count: 7,
				at: 0,
			} as never),
		).toBe('Collective Ramp ended after 7 rounds');
		expect(
			eventText({
				id: 'g3',
				kind: 'session',
				verb: 'gameEnded',
				subject: 'team-relay',
				count: 1,
				at: 0,
			} as never),
		).toBe('Team Relay ended');
	});
});

// A DM that arrived while the rider was on the bike (#1743): the channel's own
// wording for this client's own line, and the sender without the words.
describe('a DM that arrived mid-ride', () => {
	it('names the sender, and carries no field the words could ride in', () => {
		const line = dmArrivalEvent('Ruben', 1000);
		expect(eventText(line)).toBe('Ruben sent you a message');
		// Exhaustive on purpose: `track` and `subject` are the two fields an
		// event renders verbatim, and the line must have neither.
		expect(line).toEqual({
			id: 'dm:Ruben:1000',
			kind: 'dm',
			verb: 'messaged',
			actor: 'Ruben',
			count: 1,
			at: 1000,
		});
	});

	it('is one line per message', () => {
		const first = dmArrivalEvent('Ruben', 1000);
		const second = dmArrivalEvent('Ruben', 2000);
		expect(first.id).not.toBe(second.id);
	});
});
