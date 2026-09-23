import { expect, test, textPath, voicePath } from './crew';

/**
 * A text channel's line does not toast over a running session (#2531). The
 * crew talking in a text channel is not the ride the rider is on (ADR-0058),
 * so it waits in the sidebar's unread, as a DM does (#1743).
 */
const A = 'Ride Toast Rider';
const B = 'Ride Toast Talker';

test("a text channel's line waits out the ride in the unread count", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	await a.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(a, `Ride Toast ${Date.now() % 100000}`);
	const b = await riders(B);
	await channels.enter(b, opened);

	// A rides a session in the voice channel.
	await a.goto(`${voicePath(opened)}/training`);
	await a
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await a.getByRole('button', { name: 'Start a session' }).click();
	await a
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await a
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await a.getByRole('button', { name: 'Start Recovery Spin' }).click();
	await expect(a.getByRole('button', { name: 'arm a sprint' })).toBeVisible({
		timeout: 40_000,
	});

	// A is looking at the screen: an unfocused window gets the OS
	// notification instead of a toast (ADR-0042), which would pass this test
	// for the wrong reason.
	await a.bringToFront();
	expect(await a.evaluate(() => document.hasFocus())).toBe(true);
	// Everything that ever enters the toast stack, not what is left of it: a
	// toast goes by itself, so a later count would miss one that came and went.
	await a.evaluate(() => {
		const region = document.querySelector('[aria-label="notifications"]');
		const heard: string[] = [];
		(window as unknown as { toasted: string[] }).toasted = heard;
		if (region)
			new MutationObserver(() => heard.push(region.textContent ?? '')).observe(
				region,
				{ subtree: true, childList: true, characterData: true },
			);
	});

	// B says something in the crew's text channel.
	const line = `anyone for Sunday ${Date.now() % 100000}`;
	const said = await b.evaluate(
		({ channel, text }) =>
			fetch(`/api/channels/${channel}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
			}).then((res) => res.status),
		{ channel: opened.text, text: line },
	);
	expect(said).toBeLessThan(300);

	// The unread moves — which is also the moment the arrival was announced.
	const row = a
		.getByRole('navigation', { name: 'crews and channels' })
		.locator(`a[href="${textPath(opened)}"]`);
	await expect(row).toContainText('1', { timeout: 15_000 });
	// And nothing crossed the riding screen.
	await a.waitForTimeout(1500);
	const toasted = await a.evaluate(() =>
		(window as unknown as { toasted: string[] }).toasted.join('\n'),
	);
	expect(toasted, 'the line was toasted over the ride').not.toContain(line);
	await expect(a.getByRole('button', { name: 'arm a sprint' })).toBeVisible();
});
