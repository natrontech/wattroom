import { expect, test, voicePath } from './crew';

/**
 * Two riders in one session (#418; a voice channel's since ADR-0058), which
 * is the only way to see the group surfaces of the redesign at all: the crew
 * strip, the roster's execution bars and the sprint scoreboard render nothing
 * worth checking with one rider in the session, so every one of them was
 * verified by hand until now — and the crew-strip slab (#410) is exactly the
 * class of bug a second rider catches.
 *
 * The second session is real, not simulated at the protocol level: a second
 * browser context, its own dev identity (#409), its own trainer, its own
 * websocket. What rider A sees therefore came through the hub.
 */

/**
 * This spec's own two riders (#2133). B's weight is set below, so a rider
 * shared with another spec would be another spec's weight as well.
 */
const A = 'Two Riders Host';
const B = 'Two Riders Guest';

/**
 * Same FTP, different weight, so the w/kg ranking has an answer rather than a
 * coin flip: both simulators hold the same target, and 150 W is 2.7 w/kg at
 * 55 kg against 2.0 at the 75 kg default. Inside docs/SPEC.md's 30–200 kg.
 */
const B_KG = 55;

/** docs/SPEC.md's session lifecycle: a 10 s countdown before the timeline. */
const COUNTDOWN_MS = 10_000;
/** A sprint klaxons for 3 s, then the window is open for 15 s (hub/sprint.go). */
const KLAXON_MS = 3_000;

/** Slack over a live wait — the browser's timer drift, plus a 1 Hz tick. */
const SETTLE_MS = 20_000;

test('two riders share a session: crew strip, execution bars, sprint scoreboard', async ({
	riders,
	channels,
}) => {
	// The dev provider is the whole premise, and a deployed target does not
	// have one — the production synthetic signs in with a bearer instead.
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const name = `Two Riders ${Date.now() % 100000}`;
	const opened = await channels.open(a, name);

	const b = await riders(B);
	// The hub reads FTP and weight from the account once, at websocket connect
	// — so this has to happen before B joins.
	const patched = await b.evaluate(
		({ displayName, kg }) =>
			fetch('/api/me', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					// Required by the handler, and this rider's own name already.
					displayName,
					ftpWatts: 200,
					weightKg: kg,
				}),
			}).then((res) => res.status),
		{ displayName: B, kg: B_KG },
	);
	expect(patched, `could not set ${B}'s weight to ${B_KG} kg`).toBe(200);

	// B gets in the way a guest does: the crew's six characters, then the
	// voice channel.
	await channels.enter(b, opened);

	// Both on the trainer, both on the voice channel's Training place (#2449)
	// — the surface every assertion below reads, and the one that moves to
	// the session's own address when it starts (#2450).
	for (const rider of [a, b]) {
		await rider.goto(`${voicePath(opened)}/training`);
		await rider
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}

	// Any member starts a session and is its coach (ADR-0058): A picks the
	// workout and starts it.
	await a.getByRole('button', { name: 'Start a session' }).click();
	await a
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await a
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await a.getByRole('button', { name: 'Start Recovery Spin' }).click();

	// A session leaves everyone else's trainer alone until they join
	// (ADR-0059): B, free-riding on the Training place, takes the way in.
	await b
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: COUNTDOWN_MS + SETTLE_MS });

	// --- B is in A's crew strip, and pedalling ------------------------------
	const tiles = a.getByTestId('crew-tile');
	await expect(
		tiles,
		`A's crew strip should hold exactly one tile — ${B}, everyone in the session but A`,
	).toHaveCount(1, { timeout: COUNTDOWN_MS + SETTLE_MS });
	await expect(
		tiles.getByTestId('crew-name'),
		'the crew tile is somebody other than the rider who joined',
	).toHaveText(B);
	// Live watts, polled: the strip paints the moment the tick names B, and a
	// single read catches it a tick before B's first sample lands (#537).
	await expect
		.poll(
			async () => Number(await tiles.getByTestId('crew-watts').innerText()),
			{
				message: `${B} is in A's crew strip but reading 0 W — the second rider's samples are not reaching the first`,
				timeout: SETTLE_MS,
			},
		)
		.toBeGreaterThan(0);
	// And no "0 bpm" under a rider with no strap (#2160): the simulated
	// trainer reports no heart rate, and a permanent zero reads as a broken
	// strap rather than as no strap — the call #1057 made for the solo ride,
	// which every other surface keeps and this strip did not.
	await expect(
		tiles.first(),
		'the crew strip prints a heart rate for a rider who is not wearing a strap',
	).not.toContainText('bpm');

	// --- both roster rows carry an execution bar ----------------------------
	// The meter only draws with more than one rider pedalling, which is the
	// point: it is a leaderboard, and it had never been seen with a field.
	await expect(
		a.getByTestId('execution-row'),
		`A's execution meter should rank both riders, ${A} and ${B}`,
	).toHaveCount(2, { timeout: SETTLE_MS });
	await expect
		.poll(
			() =>
				a.getByTestId('execution-row').evaluateAll((rows) =>
					rows
						.map((row) => ({
							name: row.firstElementChild?.textContent?.trim() ?? '',
							width:
								row.querySelector<HTMLElement>(
									'[data-testid="execution-bar"] [style*="width"]',
								)?.style.width ?? '',
						}))
						.sort((x, y) => x.name.localeCompare(y.name)),
				),
			{
				message: `both rows of A's execution meter should name a rider and draw a bar`,
				timeout: SETTLE_MS,
			},
		)
		// Sorted the same way the rows above are, rather than written out in
		// an order that happens to be alphabetical: the meter ranks on effort,
		// so the names' own order is not something to assert.
		.toEqual(
			[A, B]
				.sort((x, y) => x.localeCompare(y))
				.map((name) => ({ name, width: expect.stringMatching(/^[\d.]+%$/) })),
		);

	// --- A arms a sprint, and the scoreboard ranks both on w/kg -------------
	await a.getByRole('button', { name: 'arm a sprint' }).click();
	await expect(
		a.getByText('all out'),
		'the sprint window never opened after the coach armed it',
	).toBeVisible({ timeout: KLAXON_MS + SETTLE_MS });

	// Read the whole board in one pass so the two rows cannot come from two
	// different ticks, and poll it: watts arrive at 4 Hz inside the window.
	const scoreboard = () =>
		a.getByTestId('sprint-standing').evaluateAll((rows) => {
			const read = (row: Element) => ({
				name:
					row
						.querySelector('[data-testid="sprint-name"]')
						?.textContent?.trim() ?? '',
				wkg: Number(
					row.querySelector('[data-testid="sprint-wkg"]')?.textContent ?? 'NaN',
				),
			});
			const board = rows.map(read);
			return {
				order: board.map((entry) => entry.name),
				ranked: board.every(
					(entry, i) => i === 0 || board[i - 1].wkg >= entry.wkg,
				),
				pedalling: board.length > 0 && board.every((entry) => entry.wkg > 0),
			};
		});
	await expect
		.poll(scoreboard, {
			message: `A's sprint scoreboard should list both riders ranked on w/kg — ${B} at ${B_KG} kg above ${A} at the 75 kg default, both with power on the board`,
			// The window is 15 s long and then the podium replaces it, so this
			// has to settle inside it.
			timeout: 12_000,
		})
		.toEqual({ order: [B, A], ranked: true, pedalling: true });
});
