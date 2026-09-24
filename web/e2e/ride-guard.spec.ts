import { expect, test, voicePath } from './crew';

/**
 * Opening another voice channel mid-ride asks first (#2602). It joins that
 * channel, which leaves this one: the call hangs up, the trainer is let go at
 * target 0 and the summary is lost — on one tap in the sidebar, while /ride
 * and /ramp have always asked.
 */
const RIDER = 'Ride Guard Rider';

test('a tap on another voice channel mid-ride asks, and Keep riding keeps it', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	const opened = await channels.open(page, `Guard ${Date.now() % 100000}`);
	// A second voice channel in the same crew, to be tempted by.
	const other = await page.evaluate(async (crew) => {
		const res = await fetch(`/api/crews/${crew}/channels`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				kind: 'voice',
				name: `Elsewhere ${Date.now() % 1000}`,
			}),
		});
		return ((await res.json()) as { id: string }).id;
	}, opened.crew);

	try {
		// Riding a session on the simulator in the first channel.
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
		await page.getByRole('button', { name: 'Start a session' }).click();
		const picker = page.getByRole('dialog', { name: 'Start a session' });
		await picker
			.getByRole('textbox', { name: 'find a workout' })
			.fill('Recovery Spin');
		await picker
			.getByRole('button', { name: /Recovery Spin/ })
			.first()
			.click();
		await picker.getByRole('button', { name: 'Start Recovery Spin' }).click();
		const end = page.getByRole('button', { name: 'end the session' });
		await expect(end).toBeVisible({ timeout: 30_000 });
		const riding = page.url();

		// The other channel in the sidebar: asked, and Keep riding keeps it.
		const elsewhere = page.locator(
			`nav[aria-label="crews and channels"] a[href="/crew/${opened.crew}/v/${other}"]`,
		);
		await elsewhere.click();
		const ask = page.getByRole('dialog');
		await expect(
			ask.getByText(`Leave the session in ${opened.name}?`),
		).toBeVisible();
		await ask.getByRole('button', { name: 'Keep riding' }).click();
		expect(page.url()).toBe(riding);
		await expect(end).toBeVisible();

		// Asked again, and the rider means it.
		await elsewhere.click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Leave the session' })
			.click();
		await page.waitForURL(`**/crew/${opened.crew}/v/${other}`, {
			timeout: 15_000,
		});
	} finally {
		await page.evaluate(
			(id) => fetch(`/api/channels/${id}`, { method: 'DELETE' }),
			other,
		);
	}
});
