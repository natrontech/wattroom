import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let apiCalls: string[] = [];
let apiResponses: unknown[] = [];
vi.mock('$lib/api', () => ({
	api: async (path: string) => {
		apiCalls.push(path);
		return apiResponses.shift() ?? { ok: true, data: undefined };
	},
}));

const { isYouTube, oembedFor, unfurl } = await import('./unfurl');

const fetchMock = vi.fn();

beforeEach(() => {
	apiCalls = [];
	apiResponses = [];
	fetchMock.mockReset();
	globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe('oembedFor (#866)', () => {
	it('claims the two services that answer a browser, and nothing else', () => {
		for (const url of [
			'https://www.youtube.com/watch?v=x',
			'https://music.youtube.com/watch?v=x',
			'https://youtu.be/x',
			'https://open.spotify.com/track/x',
		]) {
			expect(oembedFor(url), url).not.toBeNull();
		}
		for (const url of [
			'https://store.steampowered.com/app/440/',
			'https://github.com/natrontech/wattroom',
			'https://example.com',
			'not a url',
		]) {
			expect(oembedFor(url), url).toBeNull();
		}
	});
});

describe('isYouTube', () => {
	it('recognises the hosts the jukebox can take', () => {
		expect(isYouTube('youtube.com')).toBe(true);
		expect(isYouTube('music.youtube.com')).toBe(true);
		expect(isYouTube('youtu.be')).toBe(true);
		expect(isYouTube('yourtube.com')).toBe(false);
		expect(isYouTube('notyoutube.com.evil.test')).toBe(false);
	});
});

describe('unfurl (#866)', () => {
	it('asks YouTube directly and never troubles the server', async () => {
		fetchMock.mockResolvedValue(
			ok({ title: 'A ride', thumbnail_url: 'https://i.ytimg.com/x.jpg' }),
		);
		const card = await unfurl('https://youtu.be/abc');
		expect(card?.title).toBe('A ride');
		expect(apiCalls).toEqual([]);
		// Even YouTube's thumbnail goes through our proxy — the point is that
		// opening a chat tells nobody's server you were there.
		expect(card?.thumb).toBe(
			'/api/unfurl/image?url=' +
				encodeURIComponent('https://i.ytimg.com/x.jpg'),
		);
	});

	it('asks the server for everything else, and proxies its image', async () => {
		apiResponses.push({
			ok: true,
			data: {
				title: 'Team Fortress 2 on Steam',
				description: 'Nine distinct classes.',
				image: 'https://cdn.akamai.steamstatic.com/header.jpg',
				siteName: 'Steam',
				host: 'store.steampowered.com',
			},
		});
		const card = await unfurl('https://store.steampowered.com/app/440/');
		expect(card).toMatchObject({
			title: 'Team Fortress 2 on Steam',
			description: 'Nine distinct classes.',
			siteName: 'Steam',
			host: 'store.steampowered.com',
		});
		expect(card?.thumb).toContain('/api/unfurl/image?url=');
		expect(apiCalls[0]).toBe(
			'/api/unfurl?url=' +
				encodeURIComponent('https://store.steampowered.com/app/440/'),
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('is one ask per link, and remembers a no as well as a yes', async () => {
		// 204 from the server: it looked, there was nothing. Asking again on
		// every scroll is what the cache exists to stop.
		apiResponses.push({ ok: true, data: undefined });
		expect(await unfurl('https://example.com/nothing')).toBeNull();
		expect(await unfurl('https://example.com/nothing')).toBeNull();
		expect(await unfurl('https://example.com/nothing')).toBeNull();
		expect(apiCalls).toHaveLength(1);
	});

	it('never turns a data: or relative image into an <img> source', async () => {
		apiResponses.push({
			ok: true,
			data: { title: 'x', image: 'data:image/png;base64,AAAA', host: 'e.test' },
		});
		expect((await unfurl('https://e.test/a'))?.thumb).toBeUndefined();
		apiResponses.push({
			ok: true,
			data: { title: 'x', image: '/relative.png', host: 'e.test' },
		});
		expect((await unfurl('https://e.test/b'))?.thumb).toBeUndefined();
	});

	it('says nothing rather than throwing when a fetch dies', async () => {
		fetchMock.mockRejectedValue(new Error('offline'));
		expect(await unfurl('https://youtu.be/dead')).toBeNull();
		apiResponses.push({
			ok: false,
			error: { error: 'network', message: 'down' },
		});
		expect(await unfurl('https://example.com/down')).toBeNull();
	});
});
