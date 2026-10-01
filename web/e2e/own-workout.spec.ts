import { expect, test, voicePath } from './crew';

/**
 * Your own workout, beside the session (#2329, ADR-0059 amended): rider A
 * starts a session in a voice channel and rider B, in the same channel,
 * rides a workout of their own. B's trainer follows B's plan and B's ride
 * saves as B's workout; nothing of it reaches A's session — not its sprint
 * scoreboard, not the recap's "rode" — and A's session runs as it would.
 *
 * Two real riders, as two-riders.spec.ts has them: two browser contexts, two
 * dev identities, two simulated trainers, two websockets through the hub.
 */
const A = 'Own Workout Coach';
const B = 'Own Workout Rider';

/** docs/SPEC.md: a session counts in for 10 s, a ride alone for 3 s. */
const COUNTDOWN_MS = 10_000;
/** A sprint klaxons for 3 s, then the window is open for 15 s (hub/sprint.go). */
const KLAXON_MS = 3_000;
/** The saver keeps a ride from a minute (docs/SPEC.md's minute rule). */
const A_MINUTE_MS = 65_000;
const SETTLE_MS = 20_000;

test('a rider rides their own workout beside the session, and nothing of it counts there', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(240_000);

	const a = await riders(A);
	const opened = await channels.open(a, `Own Workout ${Date.now() % 100000}`);
	const b = await riders(B);
	await channels.enter(b, opened);
	for (const rider of [a, b]) {
		await rider.evaluate(() =>
			localStorage.setItem(
				'wattroom.mixer.v1',
				JSON.stringify({ music: 0, cues: 0, board: 0, share: 0 }),
			),
		);
		await rider.goto(`${voicePath(opened)}/training`);
		await rider
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}

	// A starts a session, and is its coach.
	await a.getByRole('button', { name: 'Start a session' }).click();
	const start = a.getByRole('dialog', { name: 'Start a session' });
	await start
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await start
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await start.getByRole('button', { name: 'Start Recovery Spin' }).click();

	// B picks a workout of their own from the same picker, beside it.
	await b
		.getByRole('button', { name: 'Ride a workout' })
		.click({ timeout: SETTLE_MS });
	const ride = b.getByRole('dialog', { name: 'Ride a workout' });
	await ride.getByRole('textbox', { name: 'find a workout' }).fill('Openers');
	await ride
		.getByRole('button', { name: /Openers/ })
		.first()
		.click();
	await ride.getByRole('button', { name: 'Ride Openers' }).click();

	// B's own count-in, then B's own clock, on B's own plan — while A's
	// session tells B it is there and leaves B's trainer alone.
	await expect(
		b.getByRole('button', { name: 'Skip block' }),
		"B's own workout never reached its riding screen",
	).toBeVisible({ timeout: SETTLE_MS });
	// Openers is twelve blocks and 35 minutes; the session's Recovery Spin
	// is three and 40 — B's screen, and B's trainer, are on B's.
	await expect(b.getByText('block 1 of 12')).toBeVisible();
	await expect(b.getByText(/\/ 35:00/)).toBeVisible();
	await expect(
		b.getByRole('link', { name: 'Join the ride' }),
		'the session beside B is not offered',
	).toBeVisible({ timeout: COUNTDOWN_MS + SETTLE_MS });

	// A desk at phone width: B's ride, and later B's summary, never scroll
	// sideways — measured on the place-body, where the channel's shell scrolls.
	await b.setViewportSize({ width: 375, height: 812 });
	const sideways = () =>
		Promise.all(
			['page-body', 'place-body'].map((id) =>
				b.getByTestId(id).evaluate((el) => el.scrollWidth - el.clientWidth),
			),
		);
	await expect
		.poll(sideways, { message: "B's ride scrolls sideways at 375px" })
		.toEqual([0, 0]);

	// A's sprint ranks A alone: B rides beside the session, not in it.
	await a
		.getByRole('button', { name: 'arm a sprint' })
		.click({ timeout: COUNTDOWN_MS + SETTLE_MS });
	await expect(a.getByText('all out')).toBeVisible({
		timeout: KLAXON_MS + SETTLE_MS,
	});
	await expect
		.poll(
			() =>
				a
					.getByTestId('sprint-name')
					.evaluateAll((names) => names.map((n) => n.textContent?.trim())),
			{
				message: `A's sprint scoreboard should name ${A} alone`,
				timeout: 12_000,
			},
		)
		.toEqual([A]);

	// A minute and more of B's own workout, then End: it saves as B's workout.
	await b.waitForTimeout(A_MINUTE_MS);
	await b.getByRole('button', { name: 'End ride' }).click();
	await b
		.getByRole('dialog')
		.getByRole('button', { name: 'End the ride' })
		.click();
	await expect(
		b.getByRole('link', { name: 'See your ride' }),
		"B's own workout did not save",
	).toBeVisible({ timeout: SETTLE_MS });
	await expect
		.poll(sideways, { message: "B's summary scrolls sideways at 375px" })
		.toEqual([0, 0]);
	// By the id the summary links to: B is a dev identity every run shares,
	// so B's list holds earlier runs' rides too.
	const id = (
		await b.getByRole('link', { name: 'See your ride' }).getAttribute('href')
	)
		?.split('/')
		.pop();
	const saved = await b.evaluate(async (id) => {
		const res = await fetch('/api/rides');
		const { rides } = (await res.json()) as {
			rides: { id: string; workoutName: string }[];
		};
		return rides.find((r) => r.id === id)?.workoutName;
	}, id);
	expect(saved, "B's ride saved as someone else's workout").toBe('Openers');

	// A ends the session: its recap is A's ride, and B, beside it, rode none of it.
	await a.getByRole('button', { name: 'end the session' }).click();
	await a
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();
	await expect
		.poll(
			() =>
				a.evaluate(async (crew) => {
					const res = await fetch(`/api/crews/${crew}/recaps`);
					const { recaps } = (await res.json()) as {
						recaps: {
							workout: string;
							riders: { rider: string; rode: boolean }[];
						}[];
					};
					const last = recaps.find((r) => r.workout === 'Recovery Spin');
					return last
						? last.riders.filter((r) => r.rode).map((r) => r.rider)
						: null;
				}, opened.crew),
			{ message: 'the session left no recap', timeout: SETTLE_MS },
		)
		.toEqual([A]);
});
