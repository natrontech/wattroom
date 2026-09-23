import { expect, test, voicePath } from './crew';

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
