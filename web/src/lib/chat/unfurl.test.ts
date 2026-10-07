import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let apiCalls: string[] = [];
let apiResponses: unknown[] = [];
vi.mock('$lib/api', () => ({
	api: async (path: string) => {
		apiCalls.push(path);
		return apiResponses.shift() ?? { ok: true, data: undefined };
	},
}));

const { CARD_DEADLINE_MS, holdCard, oembedFor, repeatedLinks, unfurl } =
	await import('./unfurl');

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

	it('waits out a refusal and the card still lands (#866)', async () => {
		// The ration means "early", not "nothing". A rider who opens a channel
		// full of unseen links spends the bucket; it refills over the next
		// second or two, and the card has to arrive on the message rather than
		// leaving a bare URL behind.
		vi.useFakeTimers();
		apiResponses.push({
			ok: false,
			error: { error: 'invalid_request', message: 'Too many previews.' },
		});
		apiResponses.push({
			ok: true,
			data: { title: 'It came through', host: 'example.com' },
		});
		const pending = unfurl('https://example.com/rationed');
		await vi.advanceTimersByTimeAsync(2000);
		expect((await pending)?.title).toBe('It came through');
		expect(apiCalls).toHaveLength(2);
		vi.useRealTimers();
	});

	it('gives up after the backoff, and forgets rather than remembering a no', async () => {
		vi.useFakeTimers();
		const refusal = {
			ok: false,
			error: { error: 'network', message: 'down' },
		};
		for (let i = 0; i < 4; i++) apiResponses.push(refusal);
		const pending = unfurl('https://example.com/down');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await pending).toBeNull();
		expect(apiCalls).toHaveLength(4); // the first ask plus three waits

		// Forgotten, not remembered as "this link has no card": a later render
		// starts over rather than inheriting one bad minute.
		apiResponses.push({
			ok: true,
			data: { title: 'Back up', host: 'example.com' },
		});
		expect((await unfurl('https://example.com/down'))?.title).toBe('Back up');
		vi.useRealTimers();
	});

	it('says nothing rather than throwing when a fetch dies', async () => {
		// Offline is retryable, so this rides the backoff out to its end and
		// then answers with a null like any other "no card".
		vi.useFakeTimers();
		fetchMock.mockRejectedValue(new Error('offline'));
		const pending = unfurl('https://youtu.be/dead');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(await pending).toBeNull();
		vi.useRealTimers();
	});
});

describe('holdCard (#3734)', () => {
	// A server answer that takes `ms` to arrive.
	const slow = (ms: number, title: string) =>
		new Promise((resolve) =>
			setTimeout(
				() => resolve({ ok: true, data: { title, host: 'example.com' } }),
				ms,
			),
		);

	// A line that never leaves the screen until the test says so.
	function screen() {
		let leave = () => {};
		const outOfView = (then: () => void) => {
			leave = then;
			return () => (leave = () => {});
		};
		return { outOfView, leave: () => leave() };
	}

	it('lands a card that answers inside the deadline', async () => {
		vi.useFakeTimers();
		apiResponses.push(slow(CARD_DEADLINE_MS / 2, 'Quick'));
		const shown: string[] = [];
		holdCard(
			'https://example.com/quick',
			(card) => shown.push(card.title),
			screen().outOfView,
		);
		await vi.advanceTimersByTimeAsync(CARD_DEADLINE_MS);
		expect(shown).toEqual(['Quick']);
		vi.useRealTimers();
	});

	it('holds a late card until its line has left the screen', async () => {
		// The shuffle the rider reported: a card landing seconds after the line
		// pushed every line above it up while they were reading them.
		vi.useFakeTimers();
		apiResponses.push(slow(CARD_DEADLINE_MS * 3, 'Slow'));
		const shown: string[] = [];
		const view = screen();
		holdCard(
			'https://example.com/slow',
			(card) => shown.push(card.title),
			view.outOfView,
		);
		await vi.advanceTimersByTimeAsync(CARD_DEADLINE_MS * 4);
		expect(shown).toEqual([]);
		view.leave();
		expect(shown).toEqual(['Slow']);
		vi.useRealTimers();
	});

	it('draws an answer already in at once, deadline or not', async () => {
		apiResponses.push({ ok: true, data: { title: 'Seen', host: 'e.test' } });
		await unfurl('https://e.test/seen');
		const shown: string[] = [];
		holdCard(
			'https://e.test/seen',
			(card) => shown.push(card.title),
			() => {
				throw new Error('an answer in hand waits for nothing');
			},
		);
		expect(shown).toEqual(['Seen']);
	});

	it('shows nothing for a link with nothing to show, and nothing after teardown', async () => {
		vi.useFakeTimers();
		apiResponses.push({ ok: true, data: undefined });
		const shown: string[] = [];
		holdCard(
			'https://e.test/empty',
			(c) => shown.push(c.title),
			screen().outOfView,
		);
		apiResponses.push(slow(10, 'Gone'));
		const stop = holdCard(
			'https://e.test/gone',
			(c) => shown.push(c.title),
			screen().outOfView,
		);
		stop();
		await vi.advanceTimersByTimeAsync(CARD_DEADLINE_MS);
		expect(shown).toEqual([]);
		vi.useRealTimers();
	});
});

describe('repeatedLinks (#3734)', () => {
	it('cards a link once, however often it is said', () => {
		const origin = 'https://wattroom.test';
		const repeats = repeatedLinks(
			[
				{ key: 'a', text: 'look https://example.com/route' },
				{ key: 'b', text: 'nice' },
				{ key: 'c', text: 'https://example.com/route again' },
				{ key: 'd', text: 'https://example.com/other' },
				{ key: 'e' },
				{ key: 'f', text: 'yes https://example.com/route' },
			],
			origin,
		);
		expect([...repeats]).toEqual(['c', 'f']);
	});
});
