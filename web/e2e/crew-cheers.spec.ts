import { expect, test, textPath, voicePath } from './crew';

/**
 * A crew picks its reactions in Settings (ADR-0058 moved the palette from the
 * room to the crew), and its voice channels offer exactly those (#2521) — they
 * used to show the stock set whatever the crew chose.
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Crew Cheers Owner';

const PALETTE = ['rocket', 'snowflake', 'skull', 'trophy'];

test("a voice channel offers its crew's reactions", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Crew Cheers ${Date.now() % 100000}`);
	const setPalette = (cheers: string[]) =>
		a.evaluate(
			async ({ crew, cheers }) => {
				const { name } = await fetch(`/api/crews/${crew}`).then((res) =>
					res.json(),
				);
				const res = await fetch(`/api/crews/${crew}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name, cheers }),
				});
				return res.status;
			},
			{ crew: opened.crew, cheers },
		);

	try {
		expect(await setPalette(PALETTE), 'saving the palette').toBe(200);
		await a.goto(voicePath(opened));
		for (const cheer of PALETTE)
			await expect(
				a.getByRole('button', { name: cheer, exact: true }),
			).toBeVisible({
				timeout: 15_000,
			});
		// The stock set's own, which this palette leaves out.
		await expect(
			a.getByRole('button', { name: 'party-popper', exact: true }),
		).toHaveCount(0);
	} finally {
		// The rider's crew outlives the run: back to the stock set.
		await setPalette([]);
	}
});

test("a text channel's reaction picker leads with the crew's set", async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const opened = await channels.open(a, `Crew Picks ${Date.now() % 100000}`);
	const patch = (cheers: string[]) =>
		a.evaluate(
			async ({ crew, cheers }) => {
				const { name } = await fetch(`/api/crews/${crew}`).then((res) =>
					res.json(),
				);
				await fetch(`/api/crews/${crew}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ name, cheers }),
				});
			},
			{ crew: opened.crew, cheers },
		);

	try {
		// An emoji in the set is a reaction of its own now (#2643).
		await patch(['trophy', '🥵']);
		await a.goto(textPath(opened));
		const draft = a.getByPlaceholder(/^Message /);
		await draft.fill('who is in tonight');
		await draft.press('Enter');
		const line = a.getByTestId('thread-message').last();
		await line.hover();
		await line.getByRole('button', { name: 'react' }).click();
		const picker = a.getByRole('dialog', { name: 'Pick an emoji' });
		// The text channel drew the stock set whatever the crew chose — the
		// voice channel's #2521, one surface over.
		await expect(
			picker.getByRole('button', { name: 'trophy', exact: true }),
		).toBeVisible();
		await expect(
			picker.getByRole('button', { name: 'party-popper', exact: true }),
		).toHaveCount(0);
		await picker.getByRole('button', { name: '🥵', exact: true }).click();
		await expect(
			line.getByRole('button', { name: '🥵 1', exact: true }),
		).toHaveAttribute('aria-pressed', 'true');
	} finally {
		await patch([]);
	}
});
