import { expect, test } from './room';

/**
 * Two riders in one room (#418), which is the only way to see the group
 * surfaces of the redesign at all: the crew strip, the roster's execution
 * bars and the sprint scoreboard render nothing worth checking with one
 * rider in the room, so every one of them was verified by hand until now —
 * and the crew-strip slab (#410) is exactly the class of bug a second rider
 * catches.
 *
 * The second session is real, not simulated at the protocol level: a second
 * browser context, its own dev identity (#409), its own trainer, its own
 * websocket. What rider A sees therefore came through the hub.
 */

/** The second dev rider. `?as=` accepts letters and spaces (auth.go). */
const B = 'Ruben';
const A = 'Dev Rider';

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

test('two riders share a room: crew strip, execution bars, sprint scoreboard', async ({
	riders,
	rooms,
}) => {
	// The dev provider is the whole premise, and a deployed target does not
	// have one — the production synthetic signs in with a bearer instead.
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders();
	const name = `Two Riders ${Date.now() % 100000}`;
	const room = await rooms.open(a, name);

	const b = await riders(B);
	// The hub reads FTP and weight from the account once, at websocket connect
	// (rooms.Authorize) — so this has to happen before B joins.
	const patched = await b.evaluate(
		(kg) =>
			fetch('/api/me', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					displayName: 'Ruben',
					ftpWatts: 200,
					weightKg: kg,
				}),
			}).then((res) => res.status),
		B_KG,
	);
	expect(patched, `could not set ${B}'s weight to ${B_KG} kg`).toBe(200);

	// B gets in the way a guest does: six characters, no link.
	await b.goto('/home#rooms');
	await b.locator('#join-code').fill(room.code);
	await b.getByRole('button', { name: 'Join room' }).click();
	await expect(
		b.getByRole('heading', { name }),
		`${B} never landed in "${name}" after joining with the code ${room.code}`,
	).toBeVisible({ timeout: 15_000 });

	// Both on the trainer, both on the Training place — the surface every
	// assertion below reads.
	for (const rider of [a, b]) {
		await rider.goto(`/r/${room.slug}/training`);
		await rider
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}

	// A is the owner, so A is the coach: A picks the workout and starts it.
	await a.getByRole('button', { name: 'Start a session' }).click();
	await a
		.getByRole('textbox', { name: 'find a workout' })
		.fill('Recovery Spin');
	await a
		.getByRole('button', { name: /Recovery Spin/ })
		.first()
		.click();
	await a.getByRole('button', { name: 'Start Recovery Spin' }).click();

	// --- B is in A's crew strip, and pedalling ------------------------------
	const tiles = a.getByTestId('crew-tile');
	await expect(
		tiles,
		`A's crew strip should hold exactly one tile — ${B}, everyone in the room but A`,
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
		.toEqual([
			{ name: A, width: expect.stringMatching(/^[\d.]+%$/) },
			{ name: B, width: expect.stringMatching(/^[\d.]+%$/) },
		]);

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
