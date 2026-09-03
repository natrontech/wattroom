import { describe, expect, it } from 'vitest';
import { readLink } from './jukebox-add';

const VIDEO = 'dQw4w9WgXcQ';
const LIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';

describe('readLink (#615)', () => {
	it('reads a bare id and a plain watch link as one video', () => {
		expect(readLink(VIDEO)).toEqual({
			kind: 'video',
			videoId: VIDEO,
			startSec: 0,
		});
		expect(readLink(`https://www.youtube.com/watch?v=${VIDEO}`)).toEqual({
			kind: 'video',
			videoId: VIDEO,
			startSec: 0,
		});
		expect(readLink(`https://youtu.be/${VIDEO}`)).toEqual({
			kind: 'video',
			videoId: VIDEO,
			startSec: 0,
		});
	});

	it('keeps a pasted ?t= — the room starts at the good part', () => {
		expect(readLink(`https://youtu.be/${VIDEO}?t=1m34s`)).toMatchObject({
			startSec: 94,
		});
	});

	it('reads a playlist link on its own as a playlist', () => {
		expect(readLink(`https://www.youtube.com/playlist?list=${LIST}`)).toEqual({
			kind: 'playlist',
			playlistId: LIST,
		});
	});

	it('asks when a link names a video AND the playlist it sits in', () => {
		// Before #615 this silently dropped the list and queued the video —
		// the whole point is that only the paster knows which they meant.
		expect(
			readLink(`https://www.youtube.com/watch?v=${VIDEO}&list=${LIST}&index=4`),
		).toEqual({ kind: 'both', videoId: VIDEO, startSec: 0, playlistId: LIST });
	});

	it('refuses an endless mix and the private lists, saying why', () => {
		const mix = readLink('https://www.youtube.com/playlist?list=RDabcdef');
		expect(mix.kind).toBe('error');
		expect(mix.kind === 'error' && mix.message).toMatch(/mix/i);

		const liked = readLink('https://www.youtube.com/playlist?list=LL');
		expect(liked.kind).toBe('error');
		expect(liked.kind === 'error' && liked.message).toMatch(/private/i);
	});

	it('queues the video when the unreadable list merely came along', () => {
		// A mix id next to a real video is not worth a lecture: the video is
		// plainly what the paste was about.
		expect(
			readLink(`https://www.youtube.com/watch?v=${VIDEO}&list=RDabcdef`),
		).toEqual({ kind: 'video', videoId: VIDEO, startSec: 0 });
	});

	it('says so when the text is not a YouTube link at all', () => {
		expect(readLink('hello').kind).toBe('error');
		expect(readLink('https://example.com/song').kind).toBe('error');
	});
});
