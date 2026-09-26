import { expect, test, textPath, voicePath } from './crew';

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

	await a.goto(`/crew/${opened.crew}/schedule`);
	await measure(
		'the Schedule’s Advanced',
		a.locator('summary', { hasText: 'Advanced' }),
	);

	expect(short, 'browse controls under the 24px floor').toEqual([]);
});

/**
 * The two controls a riding rider meets in the header (#2886): 'Start a
 * session' on a free ride sat at 38 px beside a 44 px End ride, and Unpair
 * sat at 28 px beside the coach's controls in a running session — small to
 * hit on purpose and easy to hit by mistake.
 */
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
});
