import { expect, test } from '@playwright/test';
import { signInTo } from './signin';

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

test('the room chat scrolls back to its oldest line', async ({ page }) => {
	// A desk-sized window: the log is the content column at any width, but the
	// people column beside it only exists from `xl`.
	await page.setViewportSize({ width: 1440, height: 700 });
	await signInTo(page, '/rooms');

	const name = `Chat Scrollback ${Date.now() % 100000}`;
	await page.locator('#open-room-name').fill(name);
	await page.getByRole('button', { name: 'Open room' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible({
		timeout: 15_000,
	});
	const slug = page.url().split('/r/')[1];

	try {
		await page.goto(`/r/${slug}/chat`);
		const log = page.getByTestId('thread-log');
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
		const box = await log.evaluate((node) => ({
			scrollTop: node.scrollTop,
			overflow: node.scrollHeight - node.clientHeight,
		}));
		expect(box.overflow).toBeGreaterThan(0);
		expect(box.scrollTop).toBe(box.overflow);

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
		const reloaded = await log.evaluate((node) => ({
			scrollTop: node.scrollTop,
			overflow: node.scrollHeight - node.clientHeight,
		}));
		expect(reloaded.overflow).toBeGreaterThan(0);
		expect(reloaded.scrollTop).toBe(reloaded.overflow);
		await log.evaluate((node) => (node.scrollTop = 0));
		await expect(page.getByText(say(1), { exact: true })).toBeInViewport();
	} finally {
		const status = await page.evaluate(
			(roomSlug) =>
				fetch(`/api/rooms/${roomSlug}`, { method: 'DELETE' }).then(
					(res) => res.status,
				),
			slug,
		);
		expect(status).toBe(204);
	}
});
