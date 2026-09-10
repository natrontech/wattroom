// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { audioKey, createSeats, type Picture } from '$lib/room/av-seats';
import type { Owned } from '$lib/room/av-types';

/**
 * Who is in which seat, and which connection put them there (#293, #1124),
 * tested with no LiveKit mock — which is the reason the rule came out of
 * `av.svelte.ts` (#1698, #2086).
 *
 * Pictures are keyed by RIDER, because the tiles and the stage are, but tagged
 * with the connection that published them. A rider with two tabs open has two
 * connections under one identity, and the older one gives its camera up on its
 * own schedule: unless every mutation asks who owns the seat first, that
 * TrackUnsubscribed deletes the track the newer tab just put there. The
 * failure is silent — the rider's picture leaves everyone's stage, nothing
 * errors, nothing logs, and the rider is on a bike three meters away.
 */

/**
 * Enough of a track to tell two of them apart, and the same object every time
 * a name is asked for — the assertions compare identity, because a seat
 * holding an equal-looking track is not the same as holding the rider's.
 */
const tracks = new Map<string, Owned['track']>();
function track(name: string): Owned['track'] {
	const made = tracks.get(name) ?? ({ sid: name } as unknown as Owned['track']);
	tracks.set(name, made);
	return made;
}

const kinds: Picture[] = ['video', 'screen'];

interface DropCase {
	/** Connections that claimed the seat, in arrival order — the last one holds it. */
	claims: string[];
	/** The connection whose track went away. */
	dropper: string;
	/** Whether the caller should go on to drop the stage seat too. */
	dropped: boolean;
	/** Who holds the seat afterwards, `undefined` for an empty one. */
	after: string | undefined;
}

const dropCases: [string, DropCase][] = [
	[
		'the connection that published it drops its own',
		{
			claims: ['jan#tab1'],
			dropper: 'jan#tab1',
			dropped: true,
			after: undefined,
		},
	],
	[
		'another tab of the same rider cannot drop it',
		{
			claims: ['jan#tab2'],
			dropper: 'jan#tab1',
			dropped: false,
			after: 'jan#tab2',
		},
	],
	[
		'a stale connection dropping after a newer one claimed the seat',
		{
			claims: ['jan#tab1', 'jan#tab2'],
			dropper: 'jan#tab1',
			dropped: false,
			after: 'jan#tab2',
		},
	],
	[
		'the newer connection dropping the seat it took over',
		{
			claims: ['jan#tab1', 'jan#tab2'],
			dropper: 'jan#tab2',
			dropped: true,
			after: undefined,
		},
	],
	[
		"a stranger's connection cannot drop a rider's seat",
		{
			claims: ['jan#tab1'],
			dropper: 'ada#tab1',
			dropped: false,
			after: 'jan#tab1',
		},
	],
	[
		'an empty seat has nothing to drop',
		{ claims: [], dropper: 'jan#tab1', dropped: false, after: undefined },
	],
];

describe.each(kinds)('dropping a %s seat', (kind) => {
	it.each(dropCases)('%s', (_name, c) => {
		const seats = createSeats();
		for (const owner of c.claims)
			seats.set(kind, 'jan', { owner, track: track(owner) });

		expect(seats.drop(kind, 'jan', c.dropper)).toBe(c.dropped);
		expect(seats.get(kind, 'jan')?.owner).toBe(c.after);
		// The owner is the tag; the track is what the rider sees. A refused
		// drop has to leave the picture itself alone, not merely the name on it.
		expect(seats.get(kind, 'jan')?.track).toBe(
			c.after === undefined ? undefined : track(c.after),
		);
	});
});

describe('asking who owns a seat', () => {
	it.each(dropCases)('%s — owns agrees with drop', (_name, c) => {
		const seats = createSeats();
		for (const owner of c.claims)
			seats.set('video', 'jan', { owner, track: track(owner) });

		expect(seats.owns('video', 'jan', c.dropper)).toBe(c.dropped);
	});

	it('answers twice without forgetting — the mute path (#851)', () => {
		// A camera switched off is a mute, not an unpublish: the subscription
		// survives and the seat must survive with it, so the unmute has
		// something to give the picture back to.
		const seats = createSeats();
		seats.set('video', 'jan', { owner: 'jan#tab1', track: track('cam') });

		expect(seats.owns('video', 'jan', 'jan#tab1')).toBe(true);
		expect(seats.owns('video', 'jan', 'jan#tab1')).toBe(true);
		expect(seats.get('video', 'jan')?.track).toBe(track('cam'));
	});
});

describe('the two kinds of picture', () => {
	it('are independent — a share ending leaves the camera seated', () => {
		const seats = createSeats();
		seats.set('video', 'jan', { owner: 'jan#tab1', track: track('cam') });
		seats.set('screen', 'jan', { owner: 'jan#tab1', track: track('screen') });

		expect(seats.drop('screen', 'jan', 'jan#tab1')).toBe(true);
		expect(seats.get('screen', 'jan')).toBeUndefined();
		expect(seats.get('video', 'jan')?.track).toBe(track('cam'));
	});

	it('are owned separately — one tab shares while another has the camera', () => {
		const seats = createSeats();
		seats.set('video', 'jan', { owner: 'jan#tab2', track: track('cam') });
		seats.set('screen', 'jan', { owner: 'jan#tab1', track: track('screen') });

		expect(seats.drop('video', 'jan', 'jan#tab1')).toBe(false);
		expect(seats.drop('screen', 'jan', 'jan#tab1')).toBe(true);
		expect(seats.get('video', 'jan')?.owner).toBe('jan#tab2');
	});
});

describe('naming an audio slot', () => {
	it('gives a rider two — their voice and their machine (#1124)', () => {
		// Keyed by identity alone the second arrival replaced the first, so
		// sharing your screen took your voice off everyone's speakers.
		expect(audioKey('jan#tab1', false)).not.toBe(audioKey('jan#tab1', true));
	});

	it('keys by connection, so two tabs of one rider do not collide', () => {
		expect(audioKey('jan#tab1', false)).not.toBe(audioKey('jan#tab2', false));
	});
});

describe('a disconnect', () => {
	it('empties every seat and takes the audio elements out of the DOM', () => {
		const seats = createSeats();
		seats.set('video', 'jan', { owner: 'jan#tab1', track: track('cam') });
		seats.set('screen', 'ada', { owner: 'ada#tab1', track: track('screen') });
		const voice = document.createElement('audio');
		const machine = document.createElement('audio');
		document.body.append(voice, machine);
		seats.audio.set(audioKey('jan#tab1', false), voice);
		seats.audio.set(audioKey('jan#tab1', true), machine);

		seats.clear();

		expect(seats.get('video', 'jan')).toBeUndefined();
		expect(seats.get('screen', 'ada')).toBeUndefined();
		expect(seats.audio.size).toBe(0);
		// Left in the DOM they go on playing a room the rider has left.
		expect(voice.isConnected).toBe(false);
		expect(machine.isConnected).toBe(false);
	});
});
