import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * A link leaving the app (#973). The unit tests own the decision — sheet or
 * clipboard, and what a dismissal says — and cannot see the wiring: whether
 * the invite button actually goes through it, and whether the label a rider
 * reads matches what the tap will do.
 *
 * Two pointers, because the whole rule is that they differ. Neither context
 * has a real share sheet to open (Chromium ships no Web Share API), so the
 * page is handed one that records what it was given — which is also the only
 * way to assert that a desk NEVER opens it.
 */

/** A recording share sheet and clipboard, installed before the app loads. */
const instrument = () => {
	(window as unknown as { __shared: unknown[] }).__shared = [];
	(window as unknown as { __copied: string[] }).__copied = [];
	Object.defineProperty(navigator, 'share', {
		configurable: true,
		value: (data: ShareData) => {
			(window as unknown as { __shared: unknown[] }).__shared.push(data);
			return Promise.resolve();
		},
	});
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText: (text: string) => {
				(window as unknown as { __copied: string[] }).__copied.push(text);
				return Promise.resolve();
			},
		},
	});
};

const shared = () => (window as unknown as { __shared: unknown[] }).__shared;
const copied = () => (window as unknown as { __copied: string[] }).__copied;

test('a desk copies the invite and says so, and never opens a sheet', async ({
	page,
	channels,
}) => {
	await page.addInitScript(instrument);
	await signInAs(page, 'Share Link Desk', '/home');
	const opened = await channels.open(page, `Share Desk ${Date.now() % 100000}`);

	// The crew's Home is the invite's one home (#1236, #2451).
	await page.goto(`/crew/${opened.crew}`);
	const button = page.getByRole('button', { name: 'Copy invite link' });
	await expect(button).toBeVisible({ timeout: 15_000 });
	await button.click();

	await expect(page.getByText('Invite link copied.')).toBeVisible();
	expect(await page.evaluate(copied)).toEqual([
		`${new URL(page.url()).origin}/c/${opened.code}`,
	]);
	// The API is there; a mouse must not reach it — the link is going into the
	// window next to this one, not into another application.
	expect(await page.evaluate(shared)).toEqual([]);
});

test.describe('on a phone', () => {
	// The standard's 375 with a finger on it (#1624, ux.md) rather than the
	// phone project's Pixel 5: `devices[...]` carries `defaultBrowserType`,
	// which a describe block may not set. `hasTouch` is the signal that
	// matters — it is what makes `(pointer: coarse)` true, which is the whole
	// question here.
	test.use({
		viewport: { width: 375, height: 812 },
		hasTouch: true,
		isMobile: true,
	});

	test('the invite button says Share, and opens the sheet', async ({
		page,
		channels,
	}) => {
		await page.addInitScript(instrument);
		await signInAs(page, 'Share Link Phone', '/home');
		const opened = await channels.open(
			page,
			`Share Phone ${Date.now() % 100000}`,
		);

		await page.goto(`/crew/${opened.crew}`);
		const button = page.getByRole('button', { name: 'Share invite link' });
		await expect(button).toBeVisible({ timeout: 15_000 });
		await button.click();

		expect(await page.evaluate(shared)).toEqual([
			{ url: `${new URL(page.url()).origin}/c/${opened.code}` },
		]);
		// The sheet is the feedback: no clipboard write behind it, and no toast
		// over it claiming a copy that did not happen.
		expect(await page.evaluate(copied)).toEqual([]);
		await expect(page.getByText('Invite link copied.')).toHaveCount(0);
	});
});
