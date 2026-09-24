import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * The crew's Board and Workouts (#2455). The Board's empty state is the one
 * place most riders learn what a pin is, so it has to carry the button that
 * makes the first one (#2405's lesson) — and the crew's newest announcement
 * leads the page, naming the channel it was marked in.
 */
test('the crew Board teaches its first pin and leads with the announcement', async ({
	page,
	channels,
}) => {
	await signInAs(page, 'Crew Board', '/home');
	const name = `Crew Board ${Date.now() % 100000}`;
	const opened = await channels.open(page, name);

	await page.goto(`/crew/${opened.crew}/board`);
	await expect(
		page.getByRole('heading', { name: 'Board', level: 1 }),
	).toBeVisible();
	// The rider is stable by name across runs (signin.ts), and so is the crew
	// their channels are opened in: clear its pins so the empty state is the
	// one drawn.
	await page.evaluate(async (crew) => {
		const pins = (await (await fetch(`/api/crews/${crew}/pins`)).json()) as {
			id: string;
		}[];
		for (const pin of pins)
			await fetch(`/api/crews/${crew}/pins/${pin.id}`, { method: 'DELETE' });
	}, opened.crew);
	await page.reload();
	const first = page
		.getByRole('button', { name: 'Pin something', exact: true })
		.last();
	await expect(first).toBeVisible();
	await first.click();
	await page.getByPlaceholder('Minecraft').fill('Door code');
	await page.getByRole('dialog').locator('textarea').fill('Code: 4711');
	await page.getByRole('button', { name: 'Pin it', exact: true }).click();
	await expect(page.getByText('Door code', { exact: true })).toBeVisible();

	// An announcement marked in the crew's text channel leads the Board, and
	// draws the crew's own emoji as chat does. 409: an earlier run's crew
	// already has it.
	const uploaded = await page.evaluate(async (crew) => {
		const png = Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			),
			(c) => c.charCodeAt(0),
		);
		const res = await fetch(`/api/crews/${crew}/emoji?name=board_dot`, {
			method: 'POST',
			headers: { 'content-type': 'image/png' },
			body: png,
		});
		return res.status;
	}, opened.crew);
	expect([201, 409]).toContain(uploaded);
	const marked = await page.evaluate(async (id) => {
		const line = await fetch(`/api/channels/${id}/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'Thursday is intervals :board_dot:' }),
		}).then((res) => res.json());
		const res = await fetch(`/api/channels/${id}/announcement`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messageId: line.id }),
		});
		return res.status;
	}, opened.text);
	expect(marked).toBe(200);
	await page.reload();
	await expect(page.getByText('Thursday is intervals')).toBeVisible();
	await expect(page.getByRole('img', { name: ':board_dot:' })).toBeVisible();
	await expect(
		page.getByText('Marked in').getByRole('link', { name, exact: true }),
	).toBeVisible();
});

test('crew Workouts teaches what gathers there', async ({ page, channels }) => {
	await signInAs(page, 'Crew Workouts', '/home');
	const { crew, voice } = await channels.open(
		page,
		`Crew Workouts ${Date.now() % 100000}`,
	);
	await page.goto(`/crew/${crew}/workouts`);
	await expect(
		page.getByRole('heading', { name: 'Workouts', level: 1 }),
	).toBeVisible();
	// A crew that has planned and ridden nothing says what the page is for,
	// and offers the way to the first one. Its plans from an earlier run go
	// first; a fixture crew never rides, so it has no recaps.
	await page.evaluate(async (crew) => {
		const { sessions } = (await (
			await fetch(`/api/crews/${crew}/schedule`)
		).json()) as { sessions: { id: string }[] };
		for (const plan of sessions)
			await fetch(`/api/crews/${crew}/schedule/${plan.id}`, {
				method: 'DELETE',
			});
	}, crew);
	await page.reload();
	// The way to the first one plans for the crew, from the crew (#2624): it
	// used to send a rider to the solo library, where every button rode alone.
	const plan = page.getByRole('link', { name: 'Plan a session' });
	await expect(plan).toHaveCount(1);
	await expect(plan).toHaveAttribute('href', `/crew/${crew}/schedule?plan`);

	// A crew with something on it keeps a way to plan something new.
	const planned = await page.evaluate(
		async ({ crew, voice }) =>
			(
				await fetch(`/api/crews/${crew}/schedule`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						workoutName: 'Openers',
						workoutJson: JSON.stringify({
							name: 'Openers',
							steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
						}),
						startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
						channelId: voice,
					}),
				})
			).ok,
		{ crew, voice },
	);
	expect(planned).toBe(true);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Planned' })).toBeVisible();
	await expect(plan).toHaveCount(1);
	await expect(plan).toHaveAttribute('href', `/crew/${crew}/schedule?plan`);
});

/**
 * Plan it again works like the Schedule's picker (#2628): it plans, so it
 * says so; the time starts at the next hour rather than empty; a crew may
 * plan with no channel yet; and channels that could not be read are the
 * page failing, not a crew with none. A ridden workout comes from a finished
 * session, so the crew's recap is served here — the plan itself is real.
 */
test('crew Workouts plans a ridden workout again like the Schedule does', async ({
	page,
	channels,
}) => {
	await signInAs(page, 'Crew Plans Again', '/home');
	const { crew } = await channels.open(
		page,
		`Plans Again ${Date.now() % 100000}`,
	);
	const name = `Openers ${Date.now() % 100000}`;
	const ended = Date.now() - 24 * 3600_000;
	await page.route(`**/api/crews/${crew}/recaps*`, (route) =>
		route.fulfill({
			json: {
				recaps: [
					{
						id: 'recap-1',
						workout: name,
						startedAt: ended - 3600_000,
						endedAt: ended,
						riders: [
							{
								id: 'peer',
								rider: 'Kim',
								from: ended - 3600_000,
								to: ended,
								rode: true,
							},
						],
					},
				],
			},
		}),
	);
	// Where the definition comes from: the rider's own shelf.
	const shelved = await page.evaluate(
		async (name) =>
			(
				await fetch('/api/workouts', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						workout: {
							name,
							steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
						},
					}),
				})
			).status,
		name,
	);
	expect([200, 201]).toContain(shelved);

	await page.goto(`/crew/${crew}/workouts`);
	const again = page.getByRole('button', { name: 'Plan it again' });
	await expect(again).toBeEnabled({ timeout: 15_000 });
	await again.click();
	const where = page.getByRole('combobox');
	await expect(
		where.locator('option', { hasText: 'No channel yet' }),
	).toHaveCount(1);
	await where.selectOption('');
	const plan = page.getByRole('button', { name: 'Plan it', exact: true });
	await expect(plan).toBeEnabled();
	await plan.click();
	await expect(page.getByText(`${name} is planned for`)).toBeVisible();

	// Channels that could not be read fail the page, with its Retry.
	await page.route(`**/api/crews/${crew}/channels*`, (route) =>
		route.fulfill({
			status: 500,
			json: {
				error: 'internal_error',
				message: 'The channels are unavailable.',
			},
		}),
	);
	await page.reload();
	await expect(page.getByText('The channels are unavailable.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});
