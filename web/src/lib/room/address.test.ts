import { describe, expect, it } from 'vitest';
import { channelAddress, onPlacePath, roomAddress } from './address';

// One address per place (#2449): the shell reads its paths from here, so a
// voice channel must never inherit a path only a room has.
describe('place addresses', () => {
	it('keeps a room exactly where it was', () => {
		const room = roomAddress('velvet', 'Velvet Hammer');
		expect(room.key).toBe('velvet');
		expect(room.ws).toBe('/ws/rooms/velvet');
		expect(room.avToken).toBe('/api/rooms/velvet/av-token');
		expect(room.chat).toBe('/api/rooms/velvet/chat');
		expect(room.home).toBe('/r/velvet');
	});

	it('gives a voice channel its own socket, token, shelf and deck', () => {
		const voice = channelAddress('c1', 'v1', 'Tuesday Spin');
		expect(voice.ws).toBe('/ws/channels/v1');
		expect(voice.avToken).toBe('/api/channels/v1/av-token');
		expect(voice.playlists).toBe('/api/crews/c1/playlists');
		expect(voice.queuePlaylist('p1')).toBe(
			'/api/channels/v1/playlists/p1/queue',
		);
		expect(voice.queueTracks).toBe('/api/channels/v1/queue');
		expect(voice.home).toBe('/crew/c1/v/v1');
		expect(voice.members).toBe('/crew/c1/members');
	});

	it('never lends a voice channel what only a room had', () => {
		const voice = channelAddress('c1', 'v1', 'Tuesday Spin');
		// No text in voice (ADR-0058, decision 4), and the channel's autoplay
		// and plans are the crew's pages, not endpoints on the channel.
		expect(voice.chat).toBeUndefined();
		expect(voice.autoplay).toBeUndefined();
		expect(voice.schedule).toBeUndefined();
		// And it matches no room: every "am I in this room" check compares slugs.
		expect(voice.slug).toBe('');
		expect(voice.key).not.toBe(roomAddress('v1').key);
	});
});

// The live place's own pages (#2460). Every check that asked
// `startsWith('/r/')` went quietly false when the room pages went: the HUD,
// the cave, the dock's corner, the rail's step aside and Leave's way out.
describe('onPlacePath', () => {
	const voice = channelAddress('c1', 'v1', 'Tuesday Spin');

	it("is true on the channel's Lounge and Training", () => {
		expect(onPlacePath('/crew/c1/v/v1', voice)).toBe(true);
		expect(onPlacePath('/crew/c1/v/v1/training', voice)).toBe(true);
	});

	it('is true on the page of the session running in it', () => {
		expect(onPlacePath('/crew/c1/s/s9', voice, 's9')).toBe(true);
		expect(onPlacePath('/crew/c1/s/s9/watch', voice, 's9')).toBe(true);
	});

	it('is false everywhere else', () => {
		// Another channel, one whose id merely starts the same, the crew.
		expect(onPlacePath('/crew/c1/v/v2', voice)).toBe(false);
		expect(onPlacePath('/crew/c1/v/v1x', voice)).toBe(false);
		expect(onPlacePath('/crew/c1', voice)).toBe(false);
		expect(onPlacePath('/crew/c1/c/v1', voice)).toBe(false);
		expect(onPlacePath('/music', voice)).toBe(false);
		// Another session, a session with none running here, another crew's.
		expect(onPlacePath('/crew/c1/s/s8', voice, 's9')).toBe(false);
		expect(onPlacePath('/crew/c1/s/s9', voice)).toBe(false);
		expect(onPlacePath('/crew/c2/s/s9', voice, 's9')).toBe(false);
	});
});
