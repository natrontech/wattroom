import { expect, test, voicePath } from './crew';
import { climbGpx } from './road-gpx';

/**
 * A road session ends with its next leg (#3103): the coach rides a session
 * on their own road, ends it, and the closing card plans the same road from
 * where the bunch stopped, a week on — a plan whose road reference carries
 * the route and the owner's metre, which is how the server reads it.
 * Behind the roads dev gate, which a dev server opens.
 */
const COUNTDOWN_MS = 10_000;
/** A summary is worth showing once it has a minute of riding (summary.svelte.ts). */
const A_MINUTE_MS = 65_000;

test('a road session’s closing card plans the next leg from where the bunch stopped', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	const coach = await riders('Next Leg Coach');
	await coach.evaluate(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	const NAME = `Leg road ${Date.now() % 100000}`;
	await coach.goto('/workouts/import');
	await coach.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await coach.getByLabel('your name for it').fill(NAME);
	await coach.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(coach.getByText(`“${NAME}” is on your routes`)).toBeVisible();

	const opened = await channels.open(coach, `Legs ${Date.now() % 100000}`);
	await coach.goto(`${voicePath(opened)}/training`);
	await coach
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker.getByRole('button', { name: 'Roads' }).click();
	await picker
		.getByRole('list', { name: 'your routes' })
		.getByRole('listitem')
		.filter({ hasText: NAME })
		.getByRole('button', { name: 'Pick' })
		.click();
	await picker.getByRole('button', { name: /^Start Road/ }).click();

	const end = coach.getByRole('button', { name: 'end the session' });
	await expect(end).toBeVisible({ timeout: COUNTDOWN_MS + 30_000 });
	await coach.waitForTimeout(A_MINUTE_MS);
	await end.click();
	await coach
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();

	const card = coach.getByRole('dialog', { name: 'Session summary' });
	await card
		.getByRole('button', { name: /^Plan next \w+ from km \d+\.\d$/ })
		.click({ timeout: 30_000 });
	await expect(
		coach.getByText('Planned — it is on the crew’s schedule.'),
	).toBeVisible();

	const plans = await coach.evaluate(async (crew) => {
		const res = await fetch(`/api/crews/${crew}/schedule`);
		return (
			(await res.json()) as {
				sessions: { workoutJson: string; startsAt: string }[];
			}
		).sessions;
	}, opened.crew);
	expect(plans).toHaveLength(1);
	const road = JSON.parse(plans[0].workoutJson).road as {
		routeId: string;
		fromM: number;
	};
	// The bunch rode a minute from the road's start: on the owner's road that
	// is past the 400 m the crew's cut leaves out, and short of its end.
	expect(road.routeId).toBeTruthy();
	expect(road.fromM).toBeGreaterThan(400);
	expect(road.fromM).toBeLessThan(2000);
	const inAWeek = Date.parse(plans[0].startsAt) - Date.now();
	expect(inAWeek).toBeGreaterThan(6 * 24 * 3600 * 1000);
	expect(inAWeek).toBeLessThan(7 * 24 * 3600 * 1000);
});
