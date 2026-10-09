import { expect, test, voicePath } from './crew';
import { climbGpx } from './road-gpx';

/**
 * Ride it first (#3621): a planned road session's card rides its road alone
 * before the day. The route's owner, who planned it, lands on their own road
 * at the plan's metre. A crew member rides the crew's cut the plan carries,
 * from the crew's metre, and the ride saves as a plain free ride, without the
 * route, which the server keeps only for its owner. Behind the roads dev
 * gate, which a dev server opens.
 */
const A_MINUTE_MS = 65_000;
const PLAN_FROM_M = 1000;

test('a planned road session’s card rides its road first, for its owner and for the crew', async ({
	riders,
	channels,
	schedules,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	const owner = await riders('First Road Owner');
	await owner.goto('/workouts/import');
	await owner.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await owner.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(owner.getByText(/is on your routes/)).toBeVisible();
	const { routes } = (await (
		await owner.request.get('/api/routes')
	).json()) as { routes: { id: string }[] };
	const routeId = routes[0].id;

	const opened = await channels.open(owner, `First ${Date.now() % 100000}`);
	await schedules.own(owner, opened.crew);
	const status = await owner.evaluate(
		async ({ crew, channelId, routeId, fromM }) => {
			const workout = {
				name: 'Road',
				steps: [{ type: 'steady', seconds: 1800, target: 0.6 }],
				road: { routeId, fromM, toM: 3000 },
			};
			const res = await fetch(`/api/crews/${crew}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName: workout.name,
					workoutJson: JSON.stringify(workout),
					startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
					channelId,
				}),
			});
			return res.status;
		},
		{ crew: opened.crew, channelId: opened.voice, routeId, fromM: PLAN_FROM_M },
	);
	expect(status).toBe(201);

	// The owner: their own road, at the plan's metre.
	await owner.goto(voicePath(opened));
	await owner
		.getByRole('region', { name: 'planned here' })
		.getByRole('link', { name: 'Ride it first' })
		.click();
	await owner.waitForURL(`/ride?road=${routeId}&from=${PLAN_FROM_M}`);
	await expect(
		owner.getByRole('button', { name: 'From km 1.0' }),
	).toHaveAttribute('aria-pressed', 'true');

	// A crew member: the crew's cut, from the crew's metre.
	const crew = await riders('First Road Rider');
	await channels.enter(crew, opened);
	await crew.evaluate(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	const cut = await crew.evaluate(async (id) => {
		const res = await fetch(`/api/crews/${id}/schedule`);
		const { sessions } = (await res.json()) as {
			sessions: { workoutJson: string }[];
		};
		return JSON.parse(sessions[0].workoutJson).road as {
			fromM: number;
			originM: number;
			profile?: string;
		};
	}, opened.crew);
	expect(cut.profile, 'the crew read the plan without its cut').toBeTruthy();
	const crewKm = ((PLAN_FROM_M - cut.originM) / 1000).toFixed(1);

	await crew.goto(voicePath(opened));
	await crew
		.getByRole('region', { name: 'planned here' })
		.getByRole('link', { name: 'Ride it first' })
		.click();
	await crew.waitForURL(/\/ride\?crew=.+&plan=/);
	await expect(crew.getByText(/^The crew’s road, from where/)).toBeVisible();
	await crew
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await crew.getByRole('button', { name: 'Start riding' }).click();
	// The invented road climbs from its first metre, so CLIMB opens by itself
	// (#3645); the distance is RIDE's, one page back.
	const computer = crew.getByTestId('bike-computer');
	await expect(computer).toHaveAttribute('data-page', 'climb', {
		timeout: 15_000,
	});
	await computer.getByRole('button', { name: 'RIDE page' }).click();
	await expect(crew.getByText(new RegExp(`^${crewKm} of `))).toBeVisible({
		timeout: 15_000,
	});

	await crew.waitForTimeout(A_MINUTE_MS);
	await crew.getByRole('button', { name: 'End ride' }).click();
	await expect(crew.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});
	const saved = await crew.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { seconds: number; distanceM?: number }[];
		};
		return rides[0];
	});
	expect(saved.seconds).toBeGreaterThanOrEqual(60);
	expect(saved.distanceM, 'the ride saved against the route').toBeUndefined();
});
