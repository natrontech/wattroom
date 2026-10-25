import type { Page, WebSocketRoute } from '@playwright/test';
import { expect, test, voicePath, type ChannelOwner } from './crew';
import { climbGpx } from './road-gpx';
import { drawing, latestRide, onTheRoad, worldOn } from './world';

// The world draws in a window the box table holds (TARGETS ride-road-world):
// Desktop Chrome's 1280 × 720 is shorter, and rides the flat road (#3668).
test.use({ viewport: { width: 1440, height: 900 } });

/**
 * The bunch in the world (#3098, ADR-0065): two riders in one session on a
 * road, each with the world on, and each screen draws both of them where the
 * other screen does — within a metre along the road and across it. What
 * either screen draws came through the hub: one bunch position, each rider's
 * offset, and the order they joined in, laid out the same way twice.
 */
const COUNTDOWN_MS = 10_000;
const SETTLE_MS = 30_000;
/**
 * The saver keeps a ride from a minute of its rider's own samples (docs/SPEC.md's
 * minute rule), and the summary shows from one. Two worlds on CI's software GL
 * stall each page's simulated trainer for seconds at a time (#3877), so a
 * minute on the session's clock is not yet a minute recorded: ride two.
 */
const RIDE_S = 120;

type Drawn = { id: string; d: number; lane: number };
type Snapshot = { t: number; mps: number; riders: Drawn[] };

/**
 * Where this screen's world drew everyone, when, and at what speed, as its
 * canvas says (RideWorld); or, once its world has handed the ride to the flat
 * road, the line saying why. A saturated runner's world misses its frames and
 * goes flat, which is the app judging right, not the bunch drawing wrong (#3877).
 */
const drawn = (page: Page) =>
	page.evaluate(() => {
		const said = document.querySelector<HTMLCanvasElement>(
			'canvas[data-riders]',
		)?.dataset.riders;
		if (said) return JSON.parse(said) as Snapshot;
		return (
			document.querySelector('[data-testid=flat-road]')?.textContent?.trim() ??
			null
		);
	});

/**
 * The coach saves the invented climb to their routes, opens a voice channel
 * the guests stand in, and starts a road session on it that every one of them
 * rides on the simulated trainer.
 */
async function rideARoad(coach: Page, guests: Page[], channels: ChannelOwner) {
	const NAME = `Bunch road ${Date.now() % 100000}`;
	await coach.goto('/workouts/import');
	await coach.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await coach.getByLabel('your name for it').fill(NAME);
	await coach.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(coach.getByText(`“${NAME}” is on your routes`)).toBeVisible();

	const opened = await channels.open(coach, `Bunch ${Date.now() % 100000}`);
	for (const guest of guests) await channels.enter(guest, opened);
	for (const page of [coach, ...guests]) {
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}
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
	for (const guest of guests)
		await guest
			.getByRole('link', { name: 'Join the ride' })
			.click({ timeout: COUNTDOWN_MS + SETTLE_MS });
}

test('two screens draw one bunch, and the session ends with both rides saved on the road @world', async ({
	riders,
	channels,
}, info) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(360_000);
	const coach = await riders('Bunch World Coach');
	const guest = await riders('Bunch World Guest');
	const said: string[] = [];
	for (const page of [coach, guest]) {
		await page
			.context()
			.addInitScript(() =>
				localStorage.setItem('wattroom.world.mode.v1', 'full'),
			);
		// A world that falls back says why in the console; a red run carries it.
		page.on('console', (m) => said.push(`${m.type()}: ${m.text()}`));
	}
	const idOf = (page: Page) =>
		page.evaluate(
			async () =>
				((await (await fetch('/api/me')).json()) as { id: string }).id,
		);
	const [coachId, guestId] = [await idOf(coach), await idOf(guest)];

	await rideARoad(coach, [guest], channels);

	try {
		// Both screens read at once, each snapshot stamped with when it was
		// taken: a rider's place on one screen, carried on at the bunch's speed
		// to the moment the other was taken, is where the other drew them.
		await expect
			.poll(
				async () => {
					const [a, b] = await Promise.all([drawn(coach), drawn(guest)]);
					if (typeof a === 'string' || typeof b === 'string')
						return `a world went to the flat road: ${JSON.stringify([a, b])}`;
					const pick = (s: Snapshot | null, id: string) =>
						s?.riders.find((r) => r.id === id);
					const ids = [coachId, guestId];
					if (!a || !b || ids.some((id) => !pick(a, id) || !pick(b, id)))
						return `not both drawn yet: ${JSON.stringify([a, b])}`;
					const since = (b.t - a.t) / 1000;
					const off = Math.max(
						...ids.flatMap((id) => [
							Math.abs(pick(a, id)!.d + a.mps * since - pick(b, id)!.d),
							Math.abs(pick(a, id)!.lane - pick(b, id)!.lane),
						]),
					);
					// Two riders ride abreast: on two lanes, never one.
					const abreast = Math.abs(
						pick(a, coachId)!.lane - pick(a, guestId)!.lane,
					);
					return off <= 1 && abreast > 0.5
						? 'one bunch'
						: `screens differ by ${off.toFixed(2)} m (coach ${coachId}, guest ${guestId}): ${JSON.stringify([a, b])}`;
				},
				{
					message: 'each screen should draw both riders where the other does',
					timeout: COUNTDOWN_MS + SETTLE_MS,
					intervals: [500],
				},
			)
			.toBe('one bunch');
		// The session's climb reaches the docked computer (#3645): the road
		// is class IV from its first metre, and a session offers CLIMB by chip.
		await expect(
			coach.locator('[data-surface=docked] [data-testid=climb-chip]'),
		).toHaveText('climb IV');

		// Two minutes in for both, the coach ends it, and each keeps a ride on
		// the one road they rode together.
		for (const page of [coach, guest])
			await expect
				.poll(() => clock(page), {
					message: 'the session never reached two minutes',
					timeout: 150_000,
				})
				.toBeGreaterThanOrEqual(RIDE_S);
		await coach.getByRole('button', { name: 'end the session' }).click();
		await coach
			.getByRole('dialog')
			.getByRole('button', { name: 'End the session' })
			.click();
		const seen = (page: Page) =>
			page
				.getByRole('dialog', { name: 'Session summary' })
				.getByRole('link', { name: 'See your ride' });
		for (const page of [coach, guest])
			await expect(seen(page)).toBeVisible({ timeout: 30_000 });
		// The list names only your own roads (#3874): the guest's ride on the
		// coach's road shows as the metres it kept along it.
		for (const [who, page] of [
			['coach', coach],
			['guest', guest],
		] as const) {
			const ride = await latestRide(page);
			expect(
				`/history/${ride?.id}`,
				`the ${who}'s newest ride is not this session's`,
			).toBe(await seen(page).getAttribute('href'));
			if (who === 'coach')
				expect(ride.road?.routeId, 'the ride saved off the road').toBeTruthy();
			expect(ride.distanceM, `the ${who}'s ride kept no road`).toBeGreaterThan(
				0,
			);
			expect(
				ride.climbedM,
				`the ${who}'s ride kept no climbing`,
			).toBeGreaterThan(0);
		}
	} finally {
		await info.attach('console', { body: said.join('\n') });
	}
});

/** How long the channel's socket stays cut: the issue's ten seconds (#3850). */
const CUT_MS = 10_000;

/** The session band's clock, in seconds. */
const clock = async (page: Page) => {
	const [m, s] = (await page.getByTestId('ride-clock').textContent())!
		.trim()
		.split(' ')[0]
		.split(':')
		.map(Number);
	return m * 60 + s;
};

test('a road session rides through ten seconds without its socket, and reconnects @world', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(180_000);
	const rider = await riders('World Socket Rider');
	await worldOn(rider.context());
	// Every channel socket through a hand on the wire: while `cut`, the page's
	// socket is closed and every redial refused, as a dead network does.
	let cut = false;
	let wire: { page: WebSocketRoute; server: WebSocketRoute } | undefined;
	await rider.routeWebSocket(/\/ws\/channels\//, (ws) => {
		if (cut) return ws.close();
		wire = { page: ws, server: ws.connectToServer() };
	});
	await rideARoad(rider, [], channels);
	await drawing(rider);
	await expect(rider.getByTestId('ride-clock')).toHaveText(/^\s*0:[1-9]/, {
		timeout: COUNTDOWN_MS + SETTLE_MS,
	});

	// Lost while it redials, Still can't reach once the backoff has settled.
	const fault = rider.getByText(
		/^(Lost the channel|Still can't reach the channel)$/,
	);
	const from = await clock(rider);
	cut = true;
	const cutAt = Date.now();
	await wire!.server.close();
	await wire!.page.close();
	await expect(fault, 'the drop went unannounced').toBeVisible();
	// The ride goes on here while the hub cannot hear it: the banner counts
	// the riding this device holds for it.
	await expect(
		rider.getByText(/0:0[5-9] of riding is buffered/),
		'the ride stopped with the socket',
	).toBeVisible({ timeout: CUT_MS });
	await rider.waitForTimeout(cutAt + CUT_MS - Date.now());
	cut = false;

	// The backoff's next dial, at most ten seconds out, finds the wire back.
	await expect(fault, 'the channel never came back').toBeHidden({
		timeout: 15_000,
	});
	await expect
		.poll(() => clock(rider), { message: 'the session lost the cut' })
		.toBeGreaterThanOrEqual(from + CUT_MS / 1000);
	await onTheRoad(rider, 'Leave the ride');
});
