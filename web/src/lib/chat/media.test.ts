import { describe, expect, it } from 'vitest';
import { gifUrl } from './media';

describe('gifUrl', () => {
	it('accepts direct media URLs from the allowlisted GIF hosts', () => {
		for (const url of [
			'https://media.tenor.com/abc123/sprint.gif',
			'https://c.tenor.com/xyz/tiny.gif',
			'https://media0.giphy.com/media/abc/giphy.gif',
			'https://media4.giphy.com/media/abc/giphy.webp',
			'https://i.giphy.com/abc.gif',
			'  https://media.tenor.com/pad/ok.gif  ',
		]) {
			expect(gifUrl(url), url).toBe(url.trim());
		}
	});

	it('refuses everything else', () => {
		for (const text of [
			'',
			'gg',
			'look https://media.tenor.com/abc/two-words.gif', // not the whole message
			'https://media.tenor.com/view/not-media', // no media extension
			'https://evil.example/steal.gif', // host not allowlisted
			'https://media.tenor.com.evil.example/x.gif', // suffix spoof
			'http://media.tenor.com/abc/plain.gif', // not https
			'https://giphy.com/gifs/page-link', // share page, not media
		]) {
			expect(gifUrl(text), text).toBeNull();
		}
	});
});
