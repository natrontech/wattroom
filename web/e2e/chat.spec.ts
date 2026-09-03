import { expect, test } from './room';
import { signInAs } from './signin';

/**
 * Room chat scrolls back (#291). This is a layout bug no unit test can reach:
 * the log used to bottom-pin with `justify-end`, which parks content against
 * the bottom edge and lets the overflow spill past the START edge — where no
 * browser will scroll. Everything but the newest few lines was simply gone.
 *
 * So it needs a real browser with a real overflowing log: enough messages to
 * outgrow it, then proof that the oldest one is reachable and that reading
 * back is not undone by the next arrival. The log moved out of the people
 * column into the room's Chat place (#504); `stickToBottom` is the same, and
 * this follows it there.
 */

const LINES = 12;

/** The hub drops a second line within the same second (hub.go, 1/s per rider). */
const RATE_LIMIT_MS = 1100;

/**
 * Long enough that a dozen cannot fit the log — which is the content column
 * now, not a 320 px panel, so each line has to be nearly the 500-char cap the
 * composer allows to overflow a desk-sized window.
 */
const say = (i: number) => `line ${i} ${'wattage '.repeat(58)}`.trim();

test('the room chat scrolls back to its oldest line', async ({
	page,
	rooms,
}) => {
	// A desk-sized window: the log is the content column at any width, but the
	// people column beside it only exists from `xl`.
	await page.setViewportSize({ width: 1440, height: 700 });
	await signInAs(page, 'Chat Scrollback', '/rooms');

	const name = `Chat Scrollback ${Date.now() % 100000}`;
	const { slug } = await rooms.open(page, name);

	await page.goto(`/r/${slug}/chat`);
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
		await page.waitForTimeout(RATE_LIMIT_MS);
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
