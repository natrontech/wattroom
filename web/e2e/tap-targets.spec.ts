import { expect, test, textPath, voicePath } from './crew';
import { openAWorkoutOnARoad } from './route';

/**
 * The kit's icon button, where a call site had typed its own (#2170).
 *
 * ux.md's floor is 24 CSS px on a browse surface (WCAG 2.2 SC 2.5.8); these
 * three were 15, 20 and 24, and the composer's two had each typed their own
 * skin, so a locked box dimmed one icon and not the other.
 */

/** This spec's own rider — nobody else's (#2133). */
const RIDER = 'Tap Target Rider';
const PHONE = { width: 375, height: 812 };
const FLOOR = 24;
/** ux.md: the size of a control a rider uses while pedalling. */
const RIDING = 44;

/** What a control actually offers a thumb. */
async function box(
	locator: ReturnType<typeof test.step> extends never ? never : any,
) {
	const rect = await locator.boundingBox();
	return rect as { width: number; height: number };
}

test('the controls a rider taps on a browse surface clear the floor', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(RIDER);
	// A friend, stubbed: the row's controls are the subject, and a real
	// friendship is friend-rows.spec.ts's (#2172).
	await a.route('**/api/friends', (route) =>
		route.fulfill({
			json: {
				code: 'TAPTAP',
				declines: [],
				friends: [
					{
						id: 'tap-target-peer',
						name: 'Tap Target Peer',
						status: 'accepted',
						at: Date.now(),
						totalXp: 100,
					},
				],
			},
		}),
	);

	await a.setViewportSize(PHONE);
	await a.goto('/friends');
	const message = a.getByRole('link', { name: 'message Tap Target Peer' });
	await expect(message).toBeVisible({ timeout: 15_000 });
	const messageBox = await box(message);
	expect(
		Math.min(messageBox.width, messageBox.height),
		`the one control that starts a DM is ${messageBox.width}×${messageBox.height}`,
	).toBeGreaterThanOrEqual(FLOOR);

	const copy = a.getByTitle('copy your friend code');
	const copyBox = await box(copy);
	expect(
		copyBox.height,
		`the code copy is ${copyBox.height}px tall`,
	).toBeGreaterThanOrEqual(FLOOR);

	// The composer's own two, in a real text channel.
	const opened = await channels.open(a, `Tap Targets ${Date.now() % 100000}`);
	await a.goto(textPath(opened));
	const attach = a.getByRole('button', { name: 'attach an image' });
	await expect(attach).toBeVisible({ timeout: 15_000 });
	const attachBox = await box(attach);
	expect(
		Math.min(attachBox.width, attachBox.height),
		`attach is ${attachBox.width}×${attachBox.height}`,
	).toBeGreaterThanOrEqual(FLOOR);
});

/**
 * Card and section actions are not words in a sentence (#2886): the btn-link
 * inline exception of #1088 does not reach them, and at 375 they were 16 and
 * 17 px — 'Save a copy' on every curated card, the shelf's two doors and the
 * 'Advanced' folds.
 */
test('the browse surfaces’ links and folds clear the floor on a phone', async ({
	riders,
	channels,
	schedules,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const a = await riders('Tap Target Browser');
	await a.setViewportSize(PHONE);
	const opened = await channels.open(a, `Tap Folds ${Date.now() % 100000}`);
	await schedules.own(a, opened.crew);

	const short: string[] = [];
	const measure = async (
		what: string,
		control: ReturnType<typeof a.getByRole>,
	) => {
		await expect(control).toBeVisible({ timeout: 15_000 });
		const { height } = await box(control);
		if (height < FLOOR) short.push(`${what} is ${height}px tall`);
	};

	await a.goto('/workouts');
	// The shelf's own doors come first; an empty shelf repeats them as its
	// call to action, already a button.
	await measure(
		'Save a copy',
		a.getByRole('link', { name: 'Save a copy' }).first(),
	);
	await measure(
		'Build a workout',
		a.getByRole('link', { name: 'Build a workout' }).first(),
	);
	await measure(
		'Import a file',
		a.getByRole('link', { name: 'Import a file' }).first(),
	);

	await a.goto('/settings/data');
	await measure(
		'Your data’s Advanced',
		a.locator('summary', { hasText: 'Advanced' }),
	);

	// The mixer's fold, and the checkbox in it, reached through its label (#3755).
	await a.goto('/settings/voice');
	const mixerFold = a.locator('summary', { hasText: 'Advanced' });
	await measure('the mixer’s Advanced', mixerFold);
	await mixerFold.click();
	await measure(
		'the mixer’s “My voice ducks it too”',
		a.locator('label', { hasText: 'My voice ducks it too' }),
	);

	await a.goto(`/crew/${opened.crew}/schedule`);
	await measure(
		'the Schedule’s Advanced',
		a.locator('summary', { hasText: 'Advanced' }),
	);

	// A fresh sheet opens on its one steady block, bands folded (#3906), and
	// its way out sits beside Save (#3919).
	await a.goto('/workouts/edit');
	await measure(
		'the editor’s cadence and heart-rate bands',
		a.locator('summary', { hasText: 'cadence and heart-rate bands' }),
	);
	await measure(
		'the editor’s Discard',
		a.getByRole('link', { name: 'Discard' }),
	);

	expect(short, 'browse controls under the 24px floor').toEqual([]);
});

/**
 * The two controls a riding rider meets in the header (#2886): 'Start a
 * session' on a free ride sat at 38 px beside a 44 px End ride, and Unpair
 * sat at 28 px beside the coach's controls in a running session — small to
 * hit on purpose and easy to hit by mistake.
 */
test('Try 3D again, on a ride held on the flat road, is riding size (#3080) @world', async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const rider = await riders('Tap Flat Road Rider');
	await rider.setViewportSize(PHONE);
	await rider.addInitScript(() => {
		localStorage.setItem('wattroom.world-slot.v1', '1');
		localStorage.setItem('wattroom.flat-road.v1', '1');
	});
	// Only a ride on a road has a world to hold on the flat road (#3663).
	await openAWorkoutOnARoad(rider);
	await rider.getByRole('button', { name: 'Ride simulated' }).click();
	await rider.getByRole('button', { name: 'Start the ride' }).click();
	const retry = rider.getByRole('button', { name: 'Try 3D again' });
	await expect(retry).toBeVisible({ timeout: 30_000 });
	const retryBox = await box(retry);
	expect(
		retryBox.height,
		`'Try 3D again' is ${retryBox.height}px tall`,
	).toBeGreaterThanOrEqual(RIDING);
});

test('the header controls a pedalling rider uses are riding size', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const coach = await riders('Tap Target Coach');
	await coach.setViewportSize(PHONE);
	const opened = await channels.open(
		coach,
		`Tap Riding ${Date.now() % 100000}`,
	);
	await coach.goto(`${voicePath(opened)}/training`);
	await coach
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });

	const start = coach.getByRole('button', { name: 'Start a session' });
	await expect(start).toBeVisible({ timeout: 15_000 });
	const startBox = await box(start);
	expect(
		startBox.height,
		`'Start a session' on a free ride is ${startBox.height}px tall`,
	).toBeGreaterThanOrEqual(RIDING);

	// Easier and Harder on the free ride's grade (#3330): hit while pedalling.
	for (const name of ['Easier', 'Harder']) {
		const pair = coach.getByRole('button', { name, exact: true });
		await expect(pair).toBeVisible();
		const pairBox = await box(pair);
		expect(
			pairBox.height,
			`${name} on a free ride is ${pairBox.height}px tall`,
		).toBeGreaterThanOrEqual(RIDING);
	}

	await start.click();
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
	const unpair = coach.getByRole('button', { name: 'Unpair trainer' });
	await expect(unpair).toBeVisible({ timeout: 15_000 });
	const unpairBox = await box(unpair);
	expect(
		unpairBox.height,
		`Unpair in a running session is ${unpairBox.height}px tall`,
	).toBeGreaterThanOrEqual(RIDING);

	// The bike computer's page dots (#3088): a page is turned mid-interval.
	const dots = coach.getByTestId('computer-dot');
	await expect(dots.first()).toBeVisible({ timeout: 15_000 });
	for (const dot of await dots.all()) {
		const dotBox = await box(dot);
		expect(
			Math.min(dotBox.width, dotBox.height),
			`a page dot is ${dotBox.width}×${dotBox.height}px`,
		).toBeGreaterThanOrEqual(RIDING);
	}
});

/**
 * Standalone text links (#3750, #3756): not inline in a sentence, so SC 2.5.8's
 * inline exception does not cover them, and each was 16–20 px tall.
 */
test('the landing header and its standalone link clear the floor', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	const header = page.getByRole('navigation', { name: 'Site' }).first();
	for (const name of [
		'Group workouts',
		'Game modes',
		'FTP test',
		'Compare',
		'Self-host',
	]) {
		const link = header.getByRole('link', { name, exact: true });
		await expect(link).toBeVisible();
		const linkBox = await box(link);
		expect(
			linkBox.height,
			`header link '${name}' is ${linkBox.height}px tall`,
		).toBeGreaterThanOrEqual(FLOOR);
	}
	const how = page.getByRole('link', { name: 'How group workouts work' });
	await how.scrollIntoViewIfNeeded();
	const howBox = await box(how);
	expect(
		howBox.height,
		`'How group workouts work' is ${howBox.height}px tall`,
	).toBeGreaterThanOrEqual(FLOOR);
});

test("Home's All rides link and a ride's back link clear the floor", async ({
	riders,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const rider = await riders('Tap Link Rider');
	await rider.setViewportSize(PHONE);
	await rider.goto('/home');
	const id = await rider.evaluate(async () => {
		const res = await fetch('/api/rides', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workoutName: 'Tap Link Ride',
				workoutJson: JSON.stringify({
					name: 'Tap Link Ride',
					author: 'e2e',
					steps: [{ type: 'steady', seconds: 120, target: 0.8 }],
				}),
				startedAt: new Date(Date.now() - 3_600_000).toISOString(),
				samples: Array.from({ length: 120 }, () => ({ watts: 200 })),
			}),
		});
		const body = (await res.json()) as { id?: string };
		return res.ok ? (body.id ?? '') : `${res.status}`;
	});
	expect(id, 'a ride to link to').not.toBe('');
	await rider.reload();
	const all = rider.getByRole('link', { name: 'All rides →' });
	await expect(all).toBeVisible({ timeout: 15_000 });
	const allBox = await box(all);
	expect(
		allBox.height,
		`'All rides →' is ${allBox.height}px tall`,
	).toBeGreaterThanOrEqual(FLOOR);

	await rider.goto(`/history/${id}`);
	const back = rider
		.getByTestId('page-body')
		.getByRole('link', { name: 'Rides', exact: true });
	await expect(back).toBeVisible({ timeout: 15_000 });
	const backBox = await box(back);
	expect(
		backBox.height,
		`the ride page's back link is ${backBox.height}px tall`,
	).toBeGreaterThanOrEqual(FLOOR);
});

/**
 * The Sound dialog calls itself "the levels you reach for mid-ride" (#3748),
 * so its faders, the gate slider and Done are riding size, and its three
 * device selects sit in one row's worth of height, none truncated to a stub.
 * The panel opens without a call: its Sound button needs the channel's av
 * store, which exists before LiveKit answers. /settings/voice draws the same
 * faders at desk size and keeps them there.
 */
test('the Sound dialog’s controls are riding size and its device row is aligned', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders('Tap Sound Rider');
	await a.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await a.setViewportSize({ width: 1440, height: 900 });
	const opened = await channels.open(a, `Tap Sound ${Date.now() % 100000}`);
	await a.goto(voicePath(opened));
	await a
		.getByRole('button', { name: /^sound — the mix/ })
		.first()
		.click();

	const dialog = a.getByRole('dialog', { name: /^Sound/ });
	await expect(dialog).toBeVisible({ timeout: 15_000 });

	const short: string[] = [];
	const ranges = dialog.locator('input[type=range]');
	for (const [i, range] of (await ranges.all()).entries()) {
		const { height } = await box(range);
		if (height < RIDING) short.push(`slider ${i} is ${height}px tall`);
	}
	expect(
		await ranges.count(),
		'five faders and the gate',
	).toBeGreaterThanOrEqual(6);
	const done = await box(dialog.getByRole('button', { name: 'Done' }));
	if (done.height < RIDING) short.push(`Done is ${done.height}px tall`);
	expect(short, 'mid-ride controls under 44px').toEqual([]);

	for (const label of ['Microphone', 'Camera', 'Speakers']) {
		const select = dialog.getByRole('combobox', {
			name: new RegExp(`^${label}`),
		});
		await expect(select, `${label} select`).toBeVisible();
		const rect = await box(select);
		// Stacked, each select spans the dialog, never a 100 px stub.
		expect(rect.width, `${label} is ${rect.width}px wide`).toBeGreaterThan(200);
	}
	const eyebrow = await dialog.getByText('speakers · voice only').boundingBox();
	expect(eyebrow!.height, 'the speakers label wrapped').toBeLessThan(20);
});
