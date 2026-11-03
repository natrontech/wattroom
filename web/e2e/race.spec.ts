import { expect, test, voicePath } from './crew';

/**
 * Two riders race to the line and the closing card places both (#3779,
 * ADR-0067). The road is a made-up flat one, heights only: no file, no place.
 */

const A = 'Race Rider One';
const B = 'Race Rider Two';

/** 2.4 km: the crew rides what is left once the first and last km stay with
 *  the owner (ADR-0063), 400 m, so the race is mostly its neutral zone. */
const ROAD_M = 2400;
const STEP_M = 20;

/** packRoad's bytes (server/internal/road/packed.go): flat and straight. */
function flatRoad(): string {
	const samples = ROAD_M / STEP_M + 1;
	const bytes = Buffer.alloc(13 + 3 * (samples - 1));
	bytes.writeUInt8(1, 0);
	bytes.writeUInt32LE(samples, 1);
	bytes.writeUInt32LE(ROAD_M * 100, 5);
	return bytes.toString('base64');
}

/** The 10 s countdown, the 3-minute neutral zone, and 400 m at simulator watts. */
const RACE_MS = (10 + 180 + 120) * 1000;

test('two riders race to the line and both are placed', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(RACE_MS + 3 * 60 * 1000);

	const a = await riders(A);
	const b = await riders(B);
	// Both numbers answered, the weight unchanged and so confirmed now: a
	// race places only a rider whose numbers somebody chose (ADR-0067).
	for (const [rider, name] of [
		[a, A],
		[b, B],
	] as const) {
		const status = await rider.evaluate(
			(displayName) =>
				fetch('/api/me', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						displayName,
						ftpWatts: 200,
						weightKg: 75,
						ftpSource: 'manual',
						weightSource: 'manual',
					}),
				}).then((res) => res.status),
			name,
		);
		expect(status, `could not answer ${name}'s FTP and weight`).toBe(200);
	}

	const route = await a.evaluate(
		(road) =>
			fetch('/api/routes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					src: 'gpx',
					eleSource: 'file',
					road,
					shape: '',
					climbs: [],
				}),
			}).then(async (res) => ({
				status: res.status,
				id: ((await res.json()) as { id?: string }).id,
			})),
		flatRoad(),
	);
	expect(route.status, 'the road was not kept').toBe(201);
	try {
		const opened = await channels.open(a, `Race ${Date.now() % 100000}`);
		await channels.enter(b, opened);
		for (const rider of [a, b]) {
			await rider.goto(`${voicePath(opened)}/training`);
			await rider
				.getByRole('button', { name: 'Ride simulated' })
				.click({ timeout: 15_000 });
		}

		await a.getByRole('button', { name: 'Start a session' }).click();
		await a.getByRole('button', { name: 'Roads', exact: true }).click();
		await a
			.getByRole('list', { name: 'your routes' })
			.getByRole('listitem')
			.filter({ hasText: '2.4 km' })
			.first()
			.getByRole('button', { name: 'Pick' })
			.click();
		await a.getByRole('button', { name: 'Race it' }).click();
		await a.getByRole('button', { name: 'Start Race' }).click();
		await b
			.getByRole('link', { name: 'Join the ride' })
			.click({ timeout: 30_000 });

		for (const [rider, you, them] of [
			[a, A, B],
			[b, B, A],
		] as const) {
			const results = rider.getByTestId('race-results');
			await expect(results, `${you} never saw the race's results`).toBeVisible({
				timeout: RACE_MS,
			});
			const placed = results.getByTestId('race-placed');
			await expect(
				placed,
				`${you}'s card should place both riders`,
			).toHaveCount(2);
			await expect(placed.filter({ hasText: 'You' })).toHaveCount(1);
			await expect(placed.filter({ hasText: them })).toHaveCount(1);
			await expect(results.getByTestId('race-unranked')).toHaveCount(0);
		}
	} finally {
		await a.evaluate(
			(id) => fetch(`/api/routes/${id}`, { method: 'DELETE' }),
			route.id,
		);
	}
});
