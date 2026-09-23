import type { Locator, Page } from '@playwright/test';
import { expect, test as crewTest, textPath, voicePath } from './crew';
import { signInAs } from './signin';

/** Every plan on a crew's calendar, cancelled. */
async function cancelEveryPlan(page: Page, crew: string): Promise<void> {
	const refused = await page.evaluate(async (id) => {
		const { sessions } = (await fetch(`/api/crews/${id}/schedule`).then((res) =>
			res.json(),
		)) as { sessions?: { id: string }[] };
		const left: string[] = [];
		for (const plan of sessions ?? []) {
			const res = await fetch(`/api/crews/${id}/schedule/${plan.id}`, {
				method: 'DELETE',
			});
			if (!res.ok) left.push(`${plan.id}: ${res.status}`);
		}
		return left;
	}, crew);
	expect(refused, 'plans the crew would not give back').toEqual([]);
}

/**
 * A plan outlives the test that made it: it is the crew's now (ADR-0058), and
 * the crew fixture keeps a rider's crew across runs — where a room used to
 * take its plans with it when the fixture deleted it. Left behind, a plan
 * spoils the next run's empty state and walks the crew towards docs/SPEC.md's
 * ceiling on planned sessions.
 *
 * So the calendar a test plans on is emptied twice: when the test takes it,
 * for a run a crash cut short, and at teardown, whatever the test did. The
 * crew is its rider's own, and every rider here belongs to one test, so
 * everything on its calendar is this test's to cancel.
 *
 * Depends on `channels` for ordering, as `channels` does on `riders`: it is
 * torn down first, while the contexts and the plans' channels still exist.
 */
const test = crewTest.extend<{
	schedules: { own(page: Page, crew: string): Promise<void> };
}>({
	schedules: async ({ channels: _channels }, use) => {
		const owned: { page: Page; crew: string }[] = [];
		await use({
			async own(page, crew) {
				owned.push({ page, crew });
				await cancelEveryPlan(page, crew);
			},
		});
		for (const { page, crew } of owned) await cancelEveryPlan(page, crew);
	},
});

// The standard, not the project's Pixel 5 (#1624): 393 px hid a Lounge that
// scrolled sideways at 375. And a spectator — the phone project ships a
// Web Bluetooth API, which is the one thing a real phone lacks, so nothing
// here ever exercised #412's capability gate.
test.use({ viewport: { width: 375, height: 812 } });
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'bluetooth', {
			get: () => undefined,
			configurable: true,
		});
	});
});

/** A plan five minutes out — due, so its row draws everything it can. */
async function planSoon(
	page: Page,
	crew: string,
	channel: string,
	workoutName: string,
): Promise<boolean> {
	return page.evaluate(
		async ({ crew, channel, workoutName }) => {
			const res = await fetch(`/api/crews/${crew}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName,
					workoutJson: JSON.stringify({
						name: workoutName,
						steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
					}),
					startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
					// Named, so the row says where it runs — the longest line it
					// has — and "Start now" has a channel to open in.
					channelId: channel,
				}),
			});
			return res.ok;
		},
		{ crew, channel, workoutName },
	);
}

/**
 * The session picker, shut by its own Close button. The room's picker also
 * shut on Escape, and on the crew's Schedule it does not — the fixme below
 * holds that; these tests close it the way a finger would.
 */
async function closePicker(page: Page): Promise<void> {
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Close', exact: true })
		.click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * A phone runs the voice channel's shell, not the retired spectator redirect
 * (#412). Keep one small-viewport walk here: the desktop suite cannot notice a
 * drawer that never opens or a text channel that becomes unreachable below
 * `md` — a voice channel has no text of its own (ADR-0058), so the chat is
 * its text twin in the crew's column (#2447).
 */
test('a phone opens a voice channel and reaches its text channel', async ({
	page,
	channels,
}) => {
	await signInAs(page, 'Mobile Room', '/home');
	const name = `Mobile Channel ${Date.now() % 100000}`;
	const opened = await channels.open(page, name);

	await expect(page.getByRole('heading', { name })).toBeVisible();
	// A spectator, even as the crew's owner: nothing that needs a trainer
	// or starts a session is offered (#412, #1624).
	await expect(
		page.getByRole('button', { name: /start a session/i }),
	).toHaveCount(0);
	await expect(page.getByRole('link', { name: /join the ride/i })).toHaveCount(
		0,
	);

	await page.getByRole('button', { name: 'open navigation' }).click();
	// The fixture opened a text and a voice channel of one name, the pair
	// every room became (ADR-0058).
	const text = page
		.locator(`a[href^="/crew/${opened.crew}/c/"]`)
		.filter({ hasText: name });
	await expect(text).toBeVisible();
	await text.click();

	await expect(page).toHaveURL(new RegExp(`${textPath(opened)}$`));
	await expect(page.getByTestId('thread-log')).toBeVisible();
});

/**
 * No place a voice channel leads to scrolls sideways on a phone either
 * (#1376). The app-wide spec exempts the voice channel's shell, and what used
 * to be one room's places holds the widest rows in the app — a planned
 * session's row of three buttons, a member's row beside two. The shell's own
 * places are measured on its place column, for the reason phone-width.spec.ts
 * gives: the document absorbs the overflow and stays exactly 375 wide. The
 * room's other places are the crew's pages now, outside the shell, so they are
 * measured on the page body, as phone-width.spec.ts measures them.
 */
test('no place a voice channel leads to scrolls sideways on a phone', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Phone Places', '/home');
	const opened = await channels.open(
		page,
		`Phone Places ${Date.now() % 100000}`,
	);
	await schedules.own(page, opened.crew);

	// The Schedule row is the widest thing here, and only exists once a
	// session is planned — without one the page asserts nothing.
	expect(
		await planSoon(page, opened.crew, opened.voice, 'Phone Width Session'),
		'could not plan a session for the Schedule row',
	).toBe(true);

	const places: [path: string, body: string][] = [
		[voicePath(opened), 'place-body'],
		[`${voicePath(opened)}/training`, 'place-body'],
		[textPath(opened), 'page-body'],
		[`/crew/${opened.crew}/schedule`, 'page-body'],
		[`/crew/${opened.crew}/members`, 'page-body'],
	];
	const wide: string[] = [];
	for (const [place, testId] of places) {
		await page.goto(place);
		const body = page.getByTestId(testId);
		await expect(body).toBeVisible();
		// Wait for the excess to settle at zero rather than a fixed 300 ms.
		const excessOf = () =>
			body.evaluate((el) => el.scrollWidth - el.clientWidth);
		await expect
			.poll(excessOf, { timeout: 3_000 })
			.toBe(0)
			.catch(() => {});
		const excess = await excessOf();
		if (excess > 0) wide.push(`${place} overflows by ${excess}px`);
		// One main per document, in the same sweep (#2164): the room shell
		// draws the landmark, and Settings drew a second one inside it — two
		// nested mains, which is invalid HTML and two "main" stops for a
		// screen reader. The 2026-09-10 accessibility pass looked for a
		// missing one and would not have seen this.
		const mains = await page.locator('main').count();
		if (mains !== 1) wide.push(`${place} has ${mains} main landmarks`);
	}
	expect(wide, 'places wider than a 375px phone').toEqual([]);
});

/**
 * The rows the sweep above calls widest never rendered in it (#1766): a crew
 * of one has no member row but the owner's, and the widest Schedule row is the
 * one with "Start now" on it, which is the cockpit's (`?full=1` spends the
 * spectator gate, #412 — Move and Cancel draw without it since #1767). So: a
 * guest, the cockpit, and the three overlays nothing at 375 measured — the
 * confirm, a context menu and the session picker.
 */
test('the coach rows, the confirm, a menu and the picker fit a phone', async ({
	page,
	riders,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Phone Rows', '/home');
	const opened = await channels.open(page, `Phone Rows ${Date.now() % 100000}`);
	await schedules.own(page, opened.crew);
	const guest = await riders('Phone Guest');
	await channels.enter(guest, opened);
	expect(
		await planSoon(page, opened.crew, opened.voice, 'Phone Rows Session'),
		'could not plan a session for the coach row',
	).toBe(true);

	// An overlay is fixed, so the page body cannot absorb it: measure the
	// box itself against the viewport.
	const fits = async (what: string, overlay: Locator) => {
		await expect(overlay, what).toBeVisible();
		const box = await overlay.boundingBox();
		expect(box, `${what} has no box`).not.toBeNull();
		expect(box!.x, `${what} starts left of the screen`).toBeGreaterThanOrEqual(
			0,
		);
		expect(box!.x + box!.width, `${what} runs past 375px`).toBeLessThanOrEqual(
			375,
		);
	};
	const noOverflow = async (what: string) => {
		const body = page.getByTestId('page-body');
		await expect(body).toBeVisible();
		const excessOf = () =>
			body.evaluate((el) => el.scrollWidth - el.clientWidth);
		await expect
			.poll(excessOf, { timeout: 3_000 })
			.toBe(0)
			.catch(() => {});
		expect(await excessOf(), `${what} overflows`).toBe(0);
	};

	// The coach's row: Start now, Move and Cancel session beside "I'm in".
	await page.goto(`/crew/${opened.crew}/schedule?full=1`);
	await expect(page.getByRole('button', { name: 'Move…' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible();
	await noOverflow('the Schedule with the coach row');

	// The confirm behind Cancel session.
	await page
		.getByRole('button', { name: 'Cancel session', exact: true })
		.click();
	await fits('the cancel confirm', page.getByRole('dialog'));
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	// The picker.
	await page.getByRole('button', { name: 'Plan a session' }).click();
	await fits('the session picker', page.getByRole('dialog'));
	// Its own Close, not Escape: Escape is the fixme below.
	await closePicker(page);

	// The guest's row, and the menu behind it. In the page, not the drawer:
	// the crew's column lists who is in each voice channel, the guest among
	// them, off-canvas at 375.
	await page.goto(`/crew/${opened.crew}/members?full=1`);
	const row = page
		.getByRole('main')
		.getByRole('listitem')
		.filter({ hasText: 'Phone Guest' })
		.first();
	await expect(row).toBeVisible();
	await noOverflow('the Members page with a guest row');
	await row.click({ button: 'right' });
	await fits('the member menu', page.getByRole('menu'));
});

/**
 * Planning is not riding (#1767). The spectator gate used to reach past the
 * cockpit and into the calendar: a room's own OWNER, holding a phone, got no
 * plan button and an empty state reading "Your coach plans them here". What
 * still needs the riding screen is starting — so the crew's Schedule offers
 * the one and not the other.
 */
test('a phone plans a session and still does not start one', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Phone Planner', '/home');
	const opened = await channels.open(
		page,
		`Phone Planner ${Date.now() % 100000}`,
	);
	await schedules.own(page, opened.crew);

	// The empty state first: this is the sentence the owner used to read.
	await page.goto(`/crew/${opened.crew}/schedule`);
	await expect(
		page.getByRole('button', { name: 'Plan the first session' }),
	).toBeVisible();
	await expect(page.getByText(/your coach plans them here/i)).toHaveCount(0);

	// The picker it opens only plans on this device. Its start half hangs off
	// a PICKED workout, so pick one — asserting against the unpicked dialog
	// would pass whatever the gate did.
	await page.getByRole('button', { name: 'Plan the first session' }).click();
	const picker = page.getByRole('dialog');
	await expect(picker).toBeVisible();
	await picker.getByRole('listitem').getByRole('button').first().click();
	await expect(
		picker.getByRole('button', { name: 'Plan it', exact: true }),
	).toBeVisible();
	await expect(
		picker.getByRole('button', { name: /start it now instead/i }),
	).toHaveCount(0);
	await closePicker(page);

	// A plan that is due, so "Start now" would draw on a riding screen. Not
	// here: the coach's own row is the phone's, the cockpit's is not.
	expect(
		await planSoon(page, opened.crew, opened.voice, 'Phone Planner Session'),
		'could not plan a session',
	).toBe(true);

	await page.goto(`/crew/${opened.crew}/schedule`);
	await expect(page.getByRole('button', { name: 'Move…' })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Cancel session', exact: true }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Start now' })).toHaveCount(0);
	await expect(page.getByText('starting soon')).toBeVisible();
});

/**
 * Escape shuts the session picker, as it shuts every other layer — the
 * topmost one only (#1625, #1969). The room's picker was closed by its shell
 * (web/src/lib/room/RoomShell.svelte's window keydown handler), and the crew's
 * Schedule (#2452) draws the same SessionPicker from its own page with no
 * handler at all: web/src/routes/crew/[id]/schedule/+page.svelte, where
 * `picking` only ever goes false from the picker's Close, its backdrop, or a
 * plan the server took. SessionPicker is not the kit's Modal, which answers
 * Escape itself. That is the app, not this test — fixme until it closes.
 */
test.fixme('Escape shuts the session picker on the crew’s Schedule', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Phone Picker Escape', '/home');
	const opened = await channels.open(
		page,
		`Phone Picker Escape ${Date.now() % 100000}`,
	);
	await schedules.own(page, opened.crew);

	await page.goto(`/crew/${opened.crew}/schedule`);
	await page.getByRole('button', { name: 'Plan the first session' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

/**
 * And the plan's menu says where Start went rather than hiding it (ux.md: a
 * missing precondition is a disabled control with a one-line hint, and every
 * object with more than one action gets a context menu).
 *
 * The room's Sessions place had that menu — I'm in, I'm out, Share link,
 * Start now, Move…, Cancel session — and the crew's Schedule (#2452) ported
 * the row without it: web/src/routes/crew/[id]/schedule/+page.svelte attaches
 * no `contextMenu` to a plan, so a right-click or a long-press on one opens
 * nothing. That is the app, not this test — fixme until the menu is back.
 */
test.fixme('a phone’s plan menu says Start is on the screen you ride on', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Phone Plan Menu', '/home');
	const opened = await channels.open(
		page,
		`Phone Plan Menu ${Date.now() % 100000}`,
	);
	await schedules.own(page, opened.crew);
	expect(
		await planSoon(page, opened.crew, opened.voice, 'Phone Plan Menu Session'),
		'could not plan a session',
	).toBe(true);

	await page.goto(`/crew/${opened.crew}/schedule`);
	await page
		.getByRole('main')
		.getByRole('listitem')
		.filter({ hasText: 'Phone Plan Menu Session' })
		.first()
		.click({ button: 'right' });
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await expect(
		menu.getByText('start it from the screen you ride on'),
	).toBeVisible();
});

/**
 * A session at its own address, on a phone (#2450): the coach opens one from
 * the voice channel's ride place on a desk, the page moves to the session's
 * URL, and a phone that follows the link — /watch included — lands in the
 * running session as a spectator, the page body no wider than the phone.
 * And an address whose session is over says so instead of a blank.
 */
test('a phone follows a session link and watches it run', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const coach = await riders('Session Coach');
	await coach.setViewportSize({ width: 1440, height: 900 });
	const name = `Session Link ${Date.now() % 100000}`;
	const opened = await channels.open(coach, name);
	await coach.goto(`${voicePath(opened)}/training`);
	await coach
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await coach.getByRole('button', { name: 'Start a session' }).click();
	await coach
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await coach
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await coach.getByRole('button', { name: 'Start Recovery Spin' }).click();
	// The ride has its own address the moment it opens.
	await coach.waitForURL(new RegExp(`/crew/${opened.crew}/s/[^/]+$`), {
		timeout: 15_000,
	});
	const session = new URL(coach.url()).pathname;

	const phone = await riders('Session Phone');
	await phone.setViewportSize({ width: 375, height: 812 });
	await channels.enter(phone, opened);
	await phone.goto(`${session}/watch`);
	await phone.waitForURL(new RegExp(`${session}$`), { timeout: 15_000 });
	await expect(phone.getByText('Recovery Spin').first()).toBeVisible({
		timeout: 15_000,
	});
	const body = phone.getByTestId('page-body');
	const width = await body.evaluate((el) => ({
		scroll: el.scrollWidth,
		client: el.clientWidth,
	}));
	expect(width.scroll, 'the session page scrolls sideways on a phone').toBe(
		width.client,
	);

	await phone.goto(`/crew/${opened.crew}/s/not-a-session`);
	await expect(
		phone.getByRole('heading', { name: 'This session has ended' }),
	).toBeVisible();
});
