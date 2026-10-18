import { expect, test, voicePath } from './crew';

/**
 * A one-off workout from the voice channel (#4082): the picker's Build a
 * workout opens the editor, and Save comes back to the channel with the
 * picker open on it, one tap from Start. It used to mean leaving for
 * Workouts and finding the channel again.
 */
const COACH = 'Build From Picker Coach';

test('a workout built from the picker comes back to it and starts', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const coach = await riders(COACH);
	const opened = await channels.open(coach, `Build ${Date.now() % 100000}`);
	const name = `One-off ${Date.now() % 100000}`;

	await coach.goto(voicePath(opened));
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	await coach
		.getByRole('dialog', { name: 'Start a session' })
		.getByRole('link', { name: 'Build a workout' })
		.click();

	await coach.waitForURL(/\/workouts\/edit\?back=/);
	await coach.getByLabel('Workout name').fill(name);
	await coach.getByRole('button', { name: 'Save' }).click();

	// Back in the channel, the picker open on what was just built, and the
	// door gone from the address so a reload opens nothing.
	await coach.waitForURL(new RegExp(`${voicePath(opened)}$`));
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await expect(
		picker.getByRole('button', { name: 'Start without a trainer' }),
	).toBeVisible();
	// Named twice, in the list and in the detail: it is the one picked.
	await expect(picker.getByText(name, { exact: true })).toHaveCount(2);
	await picker.getByRole('button', { name: 'Start without a trainer' }).click();

	await coach.waitForURL(`/crew/${opened.crew}/s/**`, { timeout: 30_000 });
	await expect(
		coach.getByRole('button', { name: 'Stop the countdown' }),
	).toBeVisible();
	await expect(coach.getByText(name).first()).toBeVisible();
});
