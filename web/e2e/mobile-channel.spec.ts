import type { Locator, Page } from '@playwright/test';
import { expect, test, textPath, voicePath } from './crew';
import { climbGpx } from './road-gpx';
import { signInAs } from './signin';
import { stubYouTube } from './youtube-stub';

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
 * How far a session page scrolls sideways, as [page body, place body]. A
 * session is the voice channel's shell, whose place scrolls inside its own
 * place-body — the page body alone stays 0 with the ride 400 px too wide
 * (#2889), which is how a session "measured" at 375 measured nothing.
 */
async function sideways(page: Page): Promise<number[]> {
	return Promise.all(
		['page-body', 'place-body'].map((id) =>
			page.getByTestId(id).evaluate((el) => el.scrollWidth - el.clientWidth),
		),
	);
}

/**
 * The session picker, shut by its own Close button: these tests close it the
 * way a finger would. Escape shuts it too, and has its own test below (#2513).
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
	// The heading is for screen readers; the top bar is where a phone reads
	// which channel this is — it said "WattRoom" (#2882 L6-16).
	await expect(
		page
			.getByRole('button', { name: 'open navigation' })
			.locator('..')
			.getByText(name, { exact: true }),
	).toBeVisible();
	// And with no camera on, a tile is not a 16:9 frame the width of the
	// phone: two to a row, so the channel's actions stay above the fold.
	const tile = await page.getByTestId('rider-tile').first().boundingBox();
	expect(tile?.width ?? 375, 'a camera-less tile fills the phone').toBeLessThan(
		375 * 0.6,
	);
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
		// One main per document, in the same sweep (#2164): the voice
		// channel's shell draws the landmark, and Settings, a place inside the
		// shell back then, drew a second one inside it — two nested mains, which is invalid HTML and two "main" stops for a
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
	// Unpaired here, so it names the choice (#2594, #2880).
	await expect(
		page.getByRole('button', { name: /^Start (now|without a trainer)$/ }),
	).toBeVisible();
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
	// Its own Close, the way a finger shuts it; Escape has its own test.
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
	await expect(
		page.getByRole('button', { name: /^Start (now|without a trainer)$/ }),
	).toHaveCount(0);
	await expect(page.getByText('starting soon')).toBeVisible();
});

/**
 * Escape shuts the session picker, as it shuts every other layer — the
 * topmost one only (#1625, #1969). The crew's Schedule (#2452) draws the
 * picker with no shell around it to answer the key, so the picker answers it
 * itself (#2513).
 */
test('Escape shuts the session picker on the crew’s Schedule', async ({
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
 * object with more than one action gets a context menu) — back since #2514.
 */
test('a phone’s plan menu says Start is on the screen you ride on', async ({
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

	// A desk beside the session draws one cheer deck, the roadside's: the
	// people column drew the same five a second time (#3941).
	const desk = await riders('Watch Desk');
	await desk.setViewportSize({ width: 1440, height: 900 });
	await channels.enter(desk, opened);
	await expect(
		desk.getByRole('button', { name: /^Hand .+ a bottle$/ }),
	).toBeVisible({ timeout: 15_000 });
	await expect(
		desk.getByRole('button', { name: 'More reactions' }),
	).toBeVisible();
	await expect(
		desk.getByRole('button', { name: 'Ring the cowbell' }),
	).toHaveCount(1);
	// Its free ride beside the session draws no roadside deck, so the people
	// column keeps the cheers.
	await desk.goto(`${voicePath(opened)}/training`);
	await expect(
		desk.getByRole('button', { name: 'Ride simulated' }),
	).toBeVisible({ timeout: 15_000 });
	await expect(
		desk.getByRole('button', { name: 'Ring the cowbell' }),
	).toHaveCount(1);

	const phone = await riders('Session Phone');
	await phone.setViewportSize({ width: 375, height: 812 });
	await channels.enter(phone, opened);
	await phone.goto(`${session}/watch`);
	await phone.waitForURL(new RegExp(`${session}$`), { timeout: 15_000 });
	await expect(phone.getByText('Recovery Spin').first()).toBeVisible({
		timeout: 15_000,
	});
	await expect
		.poll(() => sideways(phone), {
			message: 'the session page scrolls sideways at 375',
		})
		.toEqual([0, 0]);

	await phone.goto(`/crew/${opened.crew}/s/not-a-session`);
	await expect(
		phone.getByRole('heading', { name: 'This session has ended' }),
	).toBeVisible();
});

/**
 * A phone in a voice channel with a session running is offered the way to
 * watch it (#2635). The Lounge holds the ride link back from a device that
 * cannot ride (#1627), and since #2450 the session's watch page is the
 * phone's view — so the phone had no way there from the channel at all.
 * This is the project's own phone, a real spectator; `riders()` contexts are
 * desks at phone width, which see the ride link instead.
 */
test('a phone in the voice channel is offered the running session to watch', async ({
	page,
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const coach = await riders('Watch Coach');
	await coach.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(
		coach,
		`Watch Link ${Date.now() % 100000}`,
	);
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
	await coach.waitForURL(new RegExp(`/crew/${opened.crew}/s/[^/]+$`), {
		timeout: 15_000,
	});
	const session = new URL(coach.url()).pathname;

	await signInAs(page, 'Watch Phone', '/home');
	await channels.enter(page, opened);
	const watch = page.getByRole('link', { name: 'Watch the session' });
	await expect(watch).toHaveAttribute('href', `${session}/watch`, {
		timeout: 15_000,
	});
	await expect(page.getByRole('link', { name: 'Join the ride' })).toHaveCount(
		0,
	);

	// The coach's tile in the phone's two-up grid (#3768): its avatar, riding
	// badge and all, sat centred across the stat line and under the coach chip.
	const tile = page
		.getByTestId('rider-tile')
		.filter({ hasText: 'Watch Coach' });
	const stats = tile.getByTestId('tile-stats');
	await expect(stats).toBeVisible({ timeout: 15_000 });
	const avatar = tile.getByRole('img', { name: 'riding now' }).locator('..');
	await expect(avatar).toBeVisible();
	const seat = (await avatar.boundingBox())!;
	for (const [what, other] of [
		['the stat line', stats],
		['the name and its coach chip', tile.getByTestId('tile-name')],
	] as const) {
		const box = (await other.boundingBox())!;
		expect(
			seat.x < box.x + box.width &&
				box.x < seat.x + seat.width &&
				seat.y < box.y + box.height &&
				box.y < seat.y + seat.height,
			`the avatar overlaps ${what}`,
		).toBe(false);
	}

	await watch.click();
	await page.waitForURL(new RegExp(`${session}$`), { timeout: 15_000 });
	await expect(page.getByText('Recovery Spin').first()).toBeVisible({
		timeout: 15_000,
	});
	// The spectator layout only a real phone gets (#2889): the `riders()`
	// phone above is a desk at 375, which is offered the ride instead.
	await expect
		.poll(() => sideways(page), {
			message: 'the session page scrolls sideways on a phone',
		})
		.toEqual([0, 0]);
});

/** Every host the YouTube player and its API are served from. */
const YOUTUBE =
	/^https:\/\/([a-z0-9-]+\.)*(youtube(-nocookie)?\.com|ytimg\.com)\//;

/**
 * At the roadside on a phone with a track playing (#4185): below md the
 * jukebox's corner player is the phone's width, and the voice channel's page
 * scrolled the roadside deck under it. At every scroll of the page nothing of
 * the deck lies under the player, the player keeps RMF's 200 × 200 with
 * nothing over it (WATTROOM.md), and a click reaches every deck control.
 */
test('a phone at the roadside reaches every deck control while a track plays', async ({
	page,
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const coach = await riders('Roadside Coach');
	await coach.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	for (const context of [coach.context(), page.context()]) {
		await context.route(YOUTUBE, (route) => route.abort());
		await stubYouTube(context);
	}

	// A road, so the deck chalks: kept on the coach's routes across runs.
	const ROAD = 'Roadside deck climb';
	const { routes } = (await (
		await coach.request.get('/api/routes')
	).json()) as { routes: { name: string }[] };
	if (!routes.some((route) => route.name === ROAD)) {
		await coach.goto('/workouts/import');
		await coach.locator('input[type=file]').setInputFiles({
			name: 'climb.gpx',
			mimeType: 'application/gpx+xml',
			buffer: Buffer.from(climbGpx()),
		});
		await coach.getByLabel('your name for it').fill(ROAD);
		await coach.getByRole('button', { name: 'Save to my routes' }).click();
		await expect(coach.getByText(`“${ROAD}” is on your routes`)).toBeVisible();
	}

	// A track on the channel's deck, which outlives the session it plays under.
	const opened = await channels.open(coach, `Roadside ${Date.now() % 100000}`);
	const add = coach
		.getByRole('textbox', {
			name: 'add music: search your library, or paste a YouTube link',
		})
		.filter({ visible: true })
		.first();
	await add.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
	await add.press('Enter');

	await coach.goto(`${voicePath(opened)}/training`);
	await coach
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await coach.getByRole('button', { name: 'Start a session' }).click();
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker.getByRole('button', { name: 'Roads' }).click();
	await picker
		.getByRole('list', { name: 'your routes' })
		.getByRole('listitem')
		.filter({ hasText: ROAD })
		.first()
		.getByRole('button', { name: 'Pick' })
		.click();
	await picker.getByRole('button', { name: /^Start Road/ }).click();

	await signInAs(page, 'Roadside Phone', '/home');
	await channels.enter(page, opened);
	const deck = page.getByTestId('roadside-deck');
	await expect(
		deck.getByRole('group', { name: 'chalk the next climb' }),
		'the phone never stood at the roadside',
	).toBeVisible({ timeout: 40_000 });
	await expect(
		page.locator('[data-pane=jukebox-dock]'),
		'the track never reached the phone',
	).toBeVisible({ timeout: 15_000 });

	// The whole page, top to bottom: the stage seats the player while it is on
	// screen, and the corner takes it once the stage scrolls away.
	const sweep = await page.evaluate(async () => {
		const place = document.querySelector<HTMLElement>(
			'[data-testid=place-body]',
		)!;
		const dock = document.querySelector<HTMLElement>(
			'[data-pane=jukebox-dock]',
		)!;
		const deck = document.querySelector('[data-testid=roadside-deck]')!;
		const under = new Set<string>();
		const small = new Set<string>();
		const overlaid = new Set<string>();
		const outside = new Set<string>();
		let cornered = 0;
		for (let y = 0; ; y += 50) {
			place.scrollTop = y;
			// The seat is measured every 100 ms (stage-slot.svelte.ts).
			await new Promise((resolve) => setTimeout(resolve, 250));
			const d = dock.getBoundingClientRect();
			const view = place.getBoundingClientRect();
			// The corner keeps the page's 16 px gutters.
			if (dock.dataset.seated === undefined) {
				cornered++;
				if (d.left < 16 || d.right > innerWidth - 16)
					outside.add(`x ${Math.round(d.left)}–${Math.round(d.right)}`);
			}
			if (d.width < 200 || d.height < 200)
				small.add(`${Math.round(d.width)} × ${Math.round(d.height)}`);
			// Its middle and four points 8 px in from its corners, those on
			// screen: the people button sits beside the corner, never on it,
			// and a seat half scrolled away takes the player with it.
			for (const [x, at] of [
				[d.left + d.width / 2, d.top + d.height / 2],
				[d.left + 8, d.top + 8],
				[d.right - 8, d.top + 8],
				[d.left + 8, d.bottom - 8],
				[d.right - 8, d.bottom - 8],
			]) {
				if (at < 0 || at > innerHeight) continue;
				const top = document.elementFromPoint(x, at);
				if (!top || !dock.contains(top))
					overlaid.add(
						top?.getAttribute('aria-label') ?? top?.tagName ?? 'none',
					);
			}
			for (const control of deck.querySelectorAll('button')) {
				const r = control.getBoundingClientRect();
				// Only what of it the page shows: the place clips the rest.
				const from = Math.max(r.top, view.top, d.top);
				const to = Math.min(r.bottom, view.bottom, d.bottom);
				if (from < to && r.left < d.right && r.right > d.left)
					under.add(
						control.getAttribute('aria-label') ||
							control.textContent?.trim() ||
							'a control',
					);
			}
			if (y >= place.scrollHeight - place.clientHeight) break;
		}
		return {
			cornered,
			under: [...under],
			small: [...small],
			overlaid: [...overlaid],
			outside: [...outside],
		};
	});
	expect(sweep.cornered, 'the player never took its corner').toBeGreaterThan(0);
	expect(sweep.outside, 'the corner past the page gutters').toEqual([]);
	expect(sweep.under, 'deck controls under the jukebox player').toEqual([]);
	expect(sweep.small, 'the player under 200 × 200').toEqual([]);
	expect(sweep.overlaid, 'drawn over the jukebox player').toEqual([]);

	// A click reaches every control. A chalk spends the road's one climb and
	// turns the other stamps off, so the stamps are tried, not pressed.
	const controls = await deck.getByRole('button').all();
	expect(controls.length, 'the deck lost its controls').toBeGreaterThan(10);
	for (const control of controls) {
		const label = (await control.getAttribute('aria-label')) ?? '';
		await control.click({ trial: label.startsWith('Chalk'), timeout: 5_000 });
	}
});
