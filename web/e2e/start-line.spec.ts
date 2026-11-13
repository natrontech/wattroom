import { expect, test, voicePath } from './crew';
import { pressInBar } from './bar';

/**
 * A road session waits on its start line (#3228) for the coach's Start the
 * ride. Since sessions left the call (#4389) one picked in a voice channel
 * opens on the crew's own session page, which drew no line, so nothing could
 * start it (#4504). Here the coach picks a road from the call, lands on the
 * session with one Start the ride, a second rider steps on the line, and the
 * ride starts. The road is a made-up flat one, heights only: no file, no place.
 */

const A = 'Start Line Coach';
const B = 'Start Line Rider';

/** 2.4 km, flat and straight: the crew rides the middle 400 m (ADR-0063). */
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

test('a road session started in a call opens on its start line, and the coach starts it', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const b = await riders(B);
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
		const opened = await channels.open(a, `Start Line ${Date.now() % 100000}`);
		await channels.enter(b, opened);
		for (const rider of [a, b]) {
			await rider.goto(`${voicePath(opened)}/training`);
			await rider
				.getByRole('button', { name: 'Ride simulated' })
				.click({ timeout: 15_000 });
		}

		// The coach picks the road from the call: it rides together, and opens
		// on the crew's own session page.
		await pressInBar(a, 'Start a session');
		const picker = a.getByRole('dialog', { name: 'Start a session' });
		await picker.getByRole('button', { name: 'Roads', exact: true }).click();
		await picker
			.getByRole('list', { name: 'your routes' })
			.getByRole('listitem')
			.filter({ hasText: '2.4 km' })
			.first()
			.getByRole('button', { name: 'Pick' })
			.click();
		await picker.getByRole('button', { name: /^Start (?!a session)/ }).click();
		await a.waitForURL(/\/crew\/[^/]+\/s\/[^/]+/);

		// The line, once, and on it the coach's one Start the ride.
		const lineA = a.getByRole('region', { name: 'start line' });
		await expect(lineA, 'the session page draws no start line').toHaveCount(1, {
			timeout: 15_000,
		});
		const startRide = a.getByRole('button', { name: 'Start the ride' });
		await expect(startRide, 'the coach has no Start the ride').toHaveCount(1);

		// The second rider comes over from the call and waits on the line:
		// theirs to join, never to start.
		await b
			.getByRole('link', { name: 'Join the ride' })
			.click({ timeout: 30_000 });
		await b.waitForURL(/\/crew\/[^/]+\/s\/[^/]+/);
		const lineB = b.getByRole('region', { name: 'start line' });
		await expect(lineB).toHaveCount(1, { timeout: 15_000 });
		await expect(
			b.getByRole('button', { name: 'Start the ride' }),
			'a rider who is not the coach is offered Start the ride',
		).toHaveCount(0);
		await b.getByRole('button', { name: 'Join the start line' }).click();
		await expect(
			lineA.getByRole('list', { name: 'on the line' }).getByText(B),
			`${B} stepped on the line and the coach never saw it`,
		).toBeVisible({ timeout: 15_000 });

		// A trainer on the line is ready, so the coach may start, and the
		// line gives way to the count-in on both screens.
		await expect(startRide).toBeEnabled({ timeout: 15_000 });
		await startRide.click();
		await expect(lineA, 'the line stayed up after Start the ride').toHaveCount(
			0,
			{ timeout: 15_000 },
		);
		await expect(lineB).toHaveCount(0, { timeout: 15_000 });
	} finally {
		await a.evaluate(
			(id) => fetch(`/api/routes/${id}`, { method: 'DELETE' }),
			route.id,
		);
	}
});
