import { expect, test } from './crew';

/**
 * An idle deck loads nothing from YouTube (#2840). The IFrame API is over a
 * megabyte from Google and its player's timers run all ride, which buys a
 * crew that never queues a track nothing — on a phone's data plan, or a
 * laptop's battery. The player is built once a YouTube entry is on the deck.
 */
const A = 'Lazy Player Rider';

/** Every host the player and its API are served from. */
const YOUTUBE =
	/^https:\/\/([a-z0-9-]+\.)*(youtube(-nocookie)?\.com|ytimg\.com)\//;

/** A few 1 Hz ticks in the idle channel, which is when the player used to load. */
const IDLE_MS = 4_000;

test('the YouTube player loads only once the deck holds a YouTube entry', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const asked: string[] = [];
	await a.context().route(YOUTUBE, (route) => {
		asked.push(route.request().url());
		return route.abort();
	});
	await channels.open(a, `Lazy Player ${Date.now() % 100000}`);
	const add = a
		.getByRole('textbox', {
			name: 'add music: search your library, or paste a YouTube link',
		})
		.filter({ visible: true })
		.first();
	await expect(add, 'the channel never drew its deck').toBeVisible();
	await a.waitForTimeout(IDLE_MS);
	expect(asked, 'an empty deck reached YouTube').toEqual([]);

	await add.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
	await a.keyboard.press('Enter');
	await expect
		.poll(() => asked.some((url) => url.includes('/iframe_api')), {
			message: 'a queued YouTube link never loaded the player',
			timeout: 20_000,
		})
		.toBe(true);
});
