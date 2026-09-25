import { expect, test, voicePath } from './crew';

/**
 * The voice strip hears a crewmate's status change (#2732, ADR-0060). The
 * strip is up exactly when you are in the channel but off its page, and
 * only that page taught the app a crewmate's status — so a status set while
 * you were elsewhere never reached the strip.
 */
const A = 'Strip Status Host';
const B = 'Strip Status Guest';

const setStatus =
	(text: string) => async (page: import('@playwright/test').Page) =>
		page.evaluate(
			(words) =>
				fetch('/api/me/status', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: words, expiresAt: '' }),
				}).then((res) => res.status),
			text,
		);

test("the voice strip shows a crewmate's status as it changes", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Strip Status ${Date.now() % 100000}`);
	const b = await riders(B);
	await channels.enter(b, opened);
	await b.goto(voicePath(opened));
	expect(await setStatus('Out sick')(b)).toBe(200);

	// A stands in the channel, then steps out to the crew's Home — still
	// connected, which is when the strip shows who is in there.
	await a.goto(voicePath(opened));
	await a.getByRole('link', { name: 'Home', exact: true }).first().click();
	const strip = a.locator('nav').getByText('in the channel', { exact: true });
	await expect(strip).toBeVisible();
	// The crew page names B the same way: standing in the channel, not on its
	// call — "in voice" is the call alone (#2854).
	await expect(
		a.getByRole('heading', { name: 'in the channel', exact: true }),
	).toBeVisible();

	// Changed while A is away from the channel's page: only the strip's own
	// read of the crew can carry it.
	expect(await setStatus('Riding outside')(b)).toBe(200);
	await expect(
		a.locator('nav [data-testid=status-line][title="Riding outside"]').first(),
	).toBeVisible();
});
