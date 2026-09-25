import { expect, test, voicePath } from './crew';
import { signInTo } from './signin';

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

/**
 * A free ride is a ride too (ADR-0059, #2843): the lights go down, the
 * desktop HUD hears it, and a tap on another voice channel — which leaves
 * this one, ending the ride and letting the trainer go — asks first.
 */
const FREE_RIDER = 'Free Guard Rider';

test('a free ride goes dark, feeds the HUD and asks before another channel ends it', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(FREE_RIDER);
	const opened = await channels.open(page, `Free Guard ${Date.now() % 100000}`);
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
		// No session: the Training place is the free ride, on the simulator.
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
		const end = page.getByRole('button', { name: 'End ride' });
		await expect(end, 'the free ride never started recording').toBeVisible({
			timeout: 30_000,
		});
		const riding = page.url();

		await expect(page.locator('.cave'), 'the lights stayed up').toHaveCount(1);
		const hud = await page.context().newPage();
		await hud.goto('/hud');
		await expect(hud.getByTestId('hud-label')).toHaveText('Free ride', {
			timeout: 10_000,
		});
		await expect(hud.getByTestId('hud-remaining')).toContainText('ridden');
		await hud.close();

		const elsewhere = page.locator(
			`nav[aria-label="crews and channels"] a[href="/crew/${opened.crew}/v/${other}"]`,
		);
		await elsewhere.click();
		const ask = page.getByRole('dialog');
		await expect(
			ask.getByText(`End your free ride in ${opened.name}?`),
		).toBeVisible();
		await ask.getByRole('button', { name: 'Keep riding' }).click();
		expect(page.url()).toBe(riding);
		await expect(end).toBeVisible();
	} finally {
		await page.evaluate(
			(id) => fetch(`/api/channels/${id}`, { method: 'DELETE' }),
			other,
		);
	}
});

/**
 * End ride asks too (#2623): it sits beside TV and Skip block, 44 px each,
 * and a ride it ends cannot be resumed — a stray thumb at minute 40 of 60
 * filed a truncated ride.
 */
test('End ride mid-ride asks, and Keep riding keeps it', async ({ page }) => {
	await signInTo(page, '/ride?w=smoke-test');
	await page.getByRole('button', { name: 'Ride simulated' }).click();
	const trainerCard = page.getByText('Simulated Trainer').locator('..');
	await expect(trainerCard.getByText(/\d+ W · \d+ rpm/)).toBeVisible({
		timeout: 15_000,
	});
	await page.getByRole('button', { name: 'Start the ride' }).click();
	const end = page.getByRole('button', { name: 'End ride' });
	await expect(end).toBeVisible({ timeout: 15_000 });

	await end.click();
	const ask = page.getByRole('dialog');
	await expect(ask).toContainText('End the ride?');
	await ask.getByRole('button', { name: 'Keep riding' }).click();
	await expect(ask).toHaveCount(0);
	await expect(end).toBeVisible();

	await end.click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'End the ride' })
		.click();
	await expect(page.getByTestId('download-fit')).toBeVisible();
});
