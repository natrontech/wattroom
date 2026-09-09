import { describe, expect, it, vi } from 'vitest';
import { commandFromEntry, commandFromLink } from './playlists.svelte';

// readLink's own branching is jukebox-add.test.ts's job (#615) — these cover
// only what commandFromLink adds on top of it: turning a parsed link into a
// save-able command.

describe('commandFromLink (#627)', () => {
	it("passes an unparseable link's message straight through", async () => {
		const result = await commandFromLink('not a link');
		expect(result).toEqual({
			ok: false,
			message: 'That does not look like a YouTube link or video id.',
		});
	});

	it('resolves a bare video id into an add command', async () => {
		const stub = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ title: 'Warmup Mix' }), { status: 200 }),
			);
		vi.stubGlobal('fetch', stub);
		try {
			const result = await commandFromLink('dQw4w9WgXcQ');
			expect(result).toMatchObject({
				ok: true,
				command: { action: 'add', videoId: 'dQw4w9WgXcQ', title: 'Warmup Mix' },
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('commandFromEntry (#1427)', () => {
	const base = { id: 'e1', addedBy: 'Kim', title: 'x', videoId: '' };

	it('saves a library track as the library add', () => {
		expect(
			commandFromEntry({
				...base,
				trackId: 't1',
				title: 'Sandstorm',
				artist: 'Darude',
			}),
		).toEqual({
			action: 'add',
			trackId: 't1',
			title: 'Sandstorm',
			artist: 'Darude',
		});
	});

	it('saves a pasted set whole, from its first track, wherever the room was in it', () => {
		const tracks = [
			{ videoId: 'a1b2c3d4e5f', title: 'one' },
			{ videoId: 'f5e4d3c2b1a', title: 'two' },
		];
		expect(
			commandFromEntry({
				...base,
				videoId: 'f5e4d3c2b1a',
				title: 'two',
				index: 1,
				playlistId: 'PLx',
				playlistTitle: 'Set',
				tracks,
			}),
		).toEqual({
			action: 'add',
			playlistId: 'PLx',
			playlistTitle: 'Set',
			tracks,
		});
	});

	it('saves a video with the second it was pasted at, and without one when it was not', () => {
		expect(
			commandFromEntry({
				...base,
				videoId: 'dQw4w9WgXcQ',
				title: 'v',
				startSec: 42,
			}),
		).toEqual({
			action: 'add',
			videoId: 'dQw4w9WgXcQ',
			title: 'v',
			positionSec: 42,
		});
		expect(
			commandFromEntry({ ...base, videoId: 'dQw4w9WgXcQ', title: 'v' })
				.positionSec,
		).toBeUndefined();
	});
});
