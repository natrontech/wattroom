import { expect, test, voicePath } from './crew';
import { signInAs } from './signin';

/**
 * The route ride in a voice channel (#3027), on the SimulatedTrainer: a road
 * of the rider's own becomes the free ride's grade, the dot moves by the
 * watts, and the ride saves against the route, where the server's replay
 * (ADR-0074) keeps its distance and climbing. Behind the roads dev gate,
 * which a dev server opens.
 *
 * The road is invented, in the open South Atlantic (#3054): three kilometres
 * climbing 4 %, nobody's street.
 */
function climbGpx(): string {
	const perLon = 111_195 * Math.cos((30 * Math.PI) / 180);
	const points = Array.from({ length: 301 }, (_, i) => {
		const lon = -25 + (i * 10) / perLon;
		return `<trkpt lat="-30.0000000" lon="${lon.toFixed(7)}"><ele>${(100 + 0.4 * i).toFixed(1)}</ele></trkpt>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WattRoom e2e" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>A made-up climb</name><trkseg>
${points.join('\n')}
</trkseg></trk>
</gpx>`;
}

/** The saver keeps a ride from a minute (docs/SPEC.md's minute rule). */
const A_MINUTE_MS = 65_000;

test('a free ride on your own road moves along it and saves against it', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	const rider = await riders('Road Rider');
	await rider.evaluate(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	const NAME = `Made-up climb ${Date.now() % 100000}`;
	await rider.goto('/workouts/import');
	await rider.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await rider.getByLabel('your name for it').fill(NAME);
	await rider.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(rider.getByText(`“${NAME}” is on your routes`)).toBeVisible();

	const opened = await channels.open(rider, `Roads ${Date.now() % 100000}`);
	await rider.goto(`${voicePath(opened)}/training`);
	await rider
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });

	await rider.getByRole('button', { name: 'Ride a road' }).click();
	await rider
		.getByRole('list', { name: 'your routes' })
		.getByRole('listitem')
		.filter({ hasText: NAME })
		.getByRole('button', { name: 'Ride it' })
		.click();

	// On the road: Grade reads Road, the ± pair is gone, the road sets it.
	await expect(
		rider
			.getByRole('group', { name: 'what you set' })
			.getByRole('button', { name: 'Road' }),
	).toBeVisible();
	await expect(
		rider.getByRole('button', { name: 'steeper grade' }),
	).toHaveCount(0);
	await expect(rider.getByText(NAME)).toBeVisible();
	await expect(rider.getByText('0.0 of 3.0 km')).toBeVisible();

	// A desk at phone width: the road row and the pair fit (ux.md).
	await rider.setViewportSize({ width: 375, height: 812 });
	await expect
		.poll(() =>
			Promise.all(
				['page-body', 'place-body'].map((id) =>
					rider
						.getByTestId(id)
						.evaluate((el) => el.scrollWidth - el.clientWidth),
				),
			),
		)
		.toEqual([0, 0]);

	// The simulated rider holds its watts; the dot climbs the road.
	await expect
		.poll(
			async () =>
				Number(
					(await rider.getByText(/ of 3\.0 km$/).textContent())?.split(' ')[0],
				),
			{ message: 'the dot never left the start', timeout: 30_000 },
		)
		.toBeGreaterThan(0);
	await expect(
		rider.getByRole('button', { name: 'Leave the road' }),
	).toHaveCount(0);

	await rider.waitForTimeout(A_MINUTE_MS);
	await rider.getByRole('button', { name: 'End ride' }).click();
	await expect(rider.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});

	const saved = await rider.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { distanceM?: number; climbedM?: number }[];
		};
		return rides[0];
	});
	expect(saved.distanceM, 'the replay kept no distance').toBeGreaterThan(0);
	expect(saved.climbedM, 'the replay kept no climbing').toBeGreaterThan(0);
});

test('Ride it now rides your road alone, from where you left it', async ({
	page,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);
	await page.addInitScript(() =>
		localStorage.setItem(
			'wattroom.mixer.v1',
			JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
		),
	);
	await signInAs(page, 'Solo Road Rider', '/workouts/import');
	await page.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await page.getByRole('button', { name: 'Ride it now' }).click();
	await page.waitForURL(/\/ride\?road=/);
	const road = new URL(page.url()).searchParams.get('road')!;

	// Carrying on from a metre, as the recovered card's Resume at km does.
	await page.goto(`/ride?road=${road}&from=1000`);
	await expect(page.getByText('Carrying on from km 1.0.')).toBeVisible();
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.click({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Start riding' }).click();
	await expect(
		page
			.getByRole('group', { name: 'what you set' })
			.getByRole('button', { name: 'Road' }),
	).toBeVisible();
	await expect(page.getByText(/^1\.0 of 3\.0 km$/)).toBeVisible();
	await page.setViewportSize({ width: 375, height: 812 });
	await expect
		.poll(() =>
			page
				.getByTestId('page-body')
				.evaluate((el) => el.scrollWidth - el.clientWidth),
		)
		.toBe(0);

	await page.waitForTimeout(A_MINUTE_MS);
	await expect
		.poll(
			async () =>
				Number(
					(await page.getByText(/ of 3\.0 km$/).textContent())?.split(' ')[0],
				),
			{ message: 'the dot never left km 1.0' },
		)
		.toBeGreaterThan(1);
	await page.getByRole('button', { name: 'End ride' }).click();
	await expect(page.getByText('See it in your history')).toBeVisible({
		timeout: 20_000,
	});
	const saved = await page.evaluate(async () => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { distanceM?: number }[];
		};
		return rides[0];
	});
	expect(saved.distanceM, 'the replay kept no distance').toBeGreaterThan(0);
});
