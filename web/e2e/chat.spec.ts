import { expect, test, textPath } from './crew';
import { signInAs } from './signin';

/**
 * A text channel's chat scrolls back (#291; a room's until #2448). This is a
 * layout bug no unit test can reach:
 * the log used to bottom-pin with `justify-end`, which parks content against
 * the bottom edge and lets the overflow spill past the START edge — where no
 * browser will scroll. Everything but the newest few lines was simply gone.
 *
 * So it needs a real browser with a real overflowing log: enough messages to
 * outgrow it, then proof that the oldest one is reachable and that reading
 * back is not undone by the next arrival. The log moved into the room's Chat
 * place (#504) and then into the text channel (#2448); `stickToBottom` is the
 * same, and this follows it there.
 */

const LINES = 12;

/** A beat between lines, so each lands in its own read of the backlog. */
const RATE_LIMIT_MS = 1100;

/**
 * Long enough that a dozen cannot fit the log — which is the content column
 * now, not a 320 px panel, so each line has to be nearly the 500-char cap the
 * composer allows to overflow a desk-sized window.
 */
const say = (i: number) => `line ${i} ${'wattage '.repeat(58)}`.trim();

test('a text channel scrolls back to its oldest line', async ({
	page,
	channels,
}) => {
	// A desk-sized window: the log is the content column at any width, but the
	// people column beside it only exists from `xl`.
	await page.setViewportSize({ width: 1440, height: 700 });
	await signInAs(page, 'Chat Scrollback', '/home');

	const name = `Chat Scrollback ${Date.now() % 100000}`;
	const opened = await channels.open(page, name);

	await page.goto(textPath(opened));
	const log = page.getByTestId('thread-log');
	// Read live and polled, never sampled once: messages land in a burst — a
	// whole history at reload — so the newest line paints while
	// `stickToBottom` is still chasing the growing content, and a single read
	// catches the log a line short of the bottom it does reach (#537).
	const overflow = () =>
		log.evaluate((node) => node.scrollHeight - node.clientHeight);
	const fromBottom = () =>
		log.evaluate(
			(node) => node.scrollHeight - node.clientHeight - node.scrollTop,
		);
	const draft = page.getByPlaceholder(`Message ${name}…`);
	await expect(draft).toBeVisible();

	for (let i = 1; i <= LINES; i++) {
		await draft.fill(say(i));
		await draft.press('Enter');
		await expect(page.getByText(say(i), { exact: true })).toBeAttached();
		// Past the window with margin: sleeping it exactly left the next send
		// limited whenever the server's clock read landed a millisecond later.
		await page.waitForTimeout(RATE_LIMIT_MS + 250);
	}
	// Every line survived the trip; a rate-limited drop would fail here and
	// quietly weaken everything below it.
	await expect(log.getByTestId('thread-message')).toHaveCount(LINES);

	// The log outgrew its box, and it is the newest line we are looking at.
	await expect.poll(overflow).toBeGreaterThan(0);
	await expect.poll(fromBottom).toBe(0);

	// The bug in one assertion: scrolling up reaches the first line.
	await log.evaluate((node) => (node.scrollTop = 0));
	await expect(page.getByText(say(1), { exact: true })).toBeInViewport();

	// A rider reading scrollback stays where they are when the log grows.
	await draft.fill('one more');
	await draft.press('Enter');
	await expect(page.getByText('one more', { exact: true })).toBeAttached();
	expect(await log.evaluate((node) => node.scrollTop)).toBe(0);

	// Again on the persisted history (#201), not just the lines this tab
	// watched arrive: history lands in one burst rather than one line per
	// tick, which is the case a live-only check never exercises.
	await page.reload();
	await expect(page.getByText(say(LINES), { exact: true })).toBeVisible();
	await expect.poll(overflow).toBeGreaterThan(0);
	await expect.poll(fromBottom).toBe(0);
	await log.evaluate((node) => (node.scrollTop = 0));
	await expect(page.getByText(say(1), { exact: true })).toBeInViewport();
});

/**
 * Two text channels of one crew are two scrollbacks (#2448): a line said in
 * one never shows in the other, and hopping between them is navigation, not
 * a join — the thread swaps, and the composer is the new channel's.
 */
test('two channels of one crew do not cross', async ({ page, channels }) => {
	await signInAs(page, 'Channel Hop', '/home');
	const name = `Channel Hop ${Date.now() % 100000}`;
	const opened = await channels.open(page, name);
	const first = textPath(opened);
	const second = await page.evaluate(async (crew) => {
		const res = await fetch(`/api/crews/${crew}/channels`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind: 'text', name: 'second' }),
		});
		const body = (await res.json()) as { id?: string };
		// This one goes with the test; the fixture's own go at its teardown.
		return body.id ?? '';
	}, opened.crew);
	expect(second, 'a second text channel in the crew').not.toBe('');
	const secondPath = `/crew/${opened.crew}/c/${second}`;

	const other = await page.context().newPage();
	try {
		await page.goto(first);
		await other.goto(secondPath);
		const inFirst = page.getByPlaceholder(`Message ${name}…`);
		const inSecond = other.getByPlaceholder('Message second…');

		await inFirst.fill('only in the first');
		await inFirst.press('Enter');
		await inSecond.fill('only in the second');
		await inSecond.press('Enter');

		// Each tab shows its own line — which is what makes the absence of
		// the other's meaningful: both threads are live and reading.
		await expect(page.getByText('only in the first')).toBeVisible();
		await expect(other.getByText('only in the second')).toBeVisible();
		await page.waitForTimeout(1500);
		await expect(page.getByText('only in the second')).toHaveCount(0);
		await expect(other.getByText('only in the first')).toHaveCount(0);

		// Hop: the first tab goes to the second channel.
		await page.goto(secondPath);
		await expect(page.getByPlaceholder('Message second…')).toBeFocused();
		await expect(page.getByText('only in the second')).toBeVisible();
		await expect(page.getByText('only in the first')).toHaveCount(0);
	} finally {
		await other.close();
		await page.evaluate(
			(id) => fetch(`/api/channels/${id}`, { method: 'DELETE' }),
			second,
		);
	}
});

/**
 * A long log never scrolls the page (#2735). A status mark's words are
 * `sr-only` — absolutely positioned — and with nothing positioned above them
 * they escaped the log to <body>, each at its line's place in the WHOLE
 * history. The document grew to the log's height and the app could be
 * scrolled out of the window. Lines ten minutes apart each get a name header,
 * so every one carries a mark, down to the newest.
 */
test('a long log of status-marked lines leaves the page unscrollable', async ({
	page,
	channels,
}) => {
	await signInAs(page, 'Status Log', '/home');
	const opened = await channels.open(page, `Status Log ${Date.now() % 100000}`);
	const me = await page.evaluate(async () => {
		await fetch('/api/me/status', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji: '🚂', text: 'on the train' }),
		});
		return ((await (await fetch('/api/me')).json()) as { id: string }).id;
	});
	const lines = 40;
	const now = Date.now();
	await page.route(
		(url) => url.pathname === `/api/channels/${opened.text}/chat`,
		(route) =>
			route.fulfill({
				json: {
					readAt: now,
					messages: Array.from({ length: lines }, (_, i) => ({
						id: `status-log-${i}`,
						from: 'Status Log',
						fromId: me,
						text: `line ${i}`,
						at: now - (lines - i) * 10 * 60_000,
					})),
				},
			}),
	);
	try {
		await page.goto(textPath(opened));
		await expect(
			page.getByTestId('thread-log').getByTestId('status-line'),
		).toHaveCount(lines);
		const overflow = await page.evaluate(
			() => document.scrollingElement!.scrollHeight - window.innerHeight,
		);
		expect(overflow, 'px the document scrolls past the window').toBe(0);
	} finally {
		await page.evaluate(() => fetch('/api/me/status', { method: 'DELETE' }));
	}
});
