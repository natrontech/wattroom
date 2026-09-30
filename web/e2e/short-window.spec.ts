import { expect, test, voicePath } from './crew';

/**
 * A short window still lets the coach drive (#3611). The focus row gives way
 * first when a window is short, and the Instrument in it used to overflow its
 * row both ways — up over the header, where the coach's session controls
 * stopped taking clicks.
 */
const COUNTDOWN_MS = 10_000;

test('on a short window the session controls still take a click', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	const coach = await riders('Short Window Coach');
	await coach.setViewportSize({ width: 1280, height: 600 });
	const opened = await channels.open(coach, `Short ${Date.now() % 100000}`);
	const rider = await riders('Short Window Rider');
	await channels.enter(rider, opened);

	await coach.goto(voicePath(opened));
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await picker
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await picker.getByRole('button', { name: 'Start without a trainer' }).click();
	// A second rider in the session puts the crew strip on the surface: one
	// more row for the focus to give its height to.
	await rider
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: COUNTDOWN_MS + 15_000 });

	// A click that lands opens the confirm; one the Instrument swallowed never
	// does, and times out.
	await coach
		.getByRole('button', { name: 'end the session' })
		.click({ timeout: COUNTDOWN_MS + 15_000 });
	const confirm = coach.getByRole('dialog');
	await expect(
		confirm.getByRole('button', { name: 'End the session' }),
	).toBeVisible();
	await confirm.getByRole('button', { name: 'Keep riding' }).click();
	await coach
		.getByRole('button', { name: 'hand the session off' })
		.click({ timeout: 5_000 });
	await expect(
		coach.getByRole('dialog', { name: 'Hand the session off' }),
	).toBeVisible();
});
