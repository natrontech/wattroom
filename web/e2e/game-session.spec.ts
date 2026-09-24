import { expect, test, voicePath } from './crew';

/**
 * A game is a session (docs/SPEC.md's glossary, #2597). It never opened one,
 * so a game kept no rides, showed no summary, left no recap and was anyone's
 * to end; now it opens one with its starter coaching, and its end closes it.
 */
const COACH = 'Game Session Coach';
const MEMBER = 'Game Session Member';

test('a game opens a session its coach ends, and it leaves a recap', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const coach = await riders(COACH);
	const opened = await channels.open(
		coach,
		`Game Session ${Date.now() % 100000}`,
	);
	const member = await riders(MEMBER);
	await channels.enter(member, opened);
	const since = Date.now();

	await coach.goto(voicePath(opened));
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker.getByRole('button', { name: 'Games' }).click();
	// The mode's own card: every card has a Start game.
	await picker
		.locator('div.rounded-lg')
		.filter({ hasText: 'Floor is Lava' })
		.getByRole('button', { name: 'Start game' })
		.click();

	// A session, and the coach's: End and End game are there, and the two
	// controls a game has no use for — it keeps its own clock and sprints —
	// are not.
	await expect(
		coach.getByRole('button', { name: 'end the session' }),
	).toBeVisible({ timeout: 15_000 });
	await expect(
		coach.getByRole('button', { name: 'end the game' }),
	).toBeVisible();
	await expect(
		coach.getByRole('button', { name: 'pause the session' }),
	).toHaveCount(0);
	await expect(coach.getByRole('button', { name: 'arm a sprint' })).toHaveCount(
		0,
	);
	// A member rides it; ending it is not theirs.
	await expect(member.getByRole('link', { name: /Join the ride/ })).toBeVisible(
		{ timeout: 15_000 },
	);
	await expect(
		member.getByRole('button', { name: 'end the game' }),
	).toHaveCount(0);

	await coach.getByRole('button', { name: 'end the game' }).click();

	// Its end is the session's: the channel is free again, and the crew keeps
	// its recap, named for the mode.
	await expect(
		member.getByRole('button', { name: 'Start a session' }),
	).toBeVisible({
		timeout: 15_000,
	});
	await expect
		.poll(
			() =>
				coach.evaluate(
					async ({ crew, since }) => {
						const res = await fetch(`/api/crews/${crew}/recaps`);
						const { recaps } = (await res.json()) as {
							recaps: { workout: string; endedAt: number }[];
						};
						return recaps.some(
							(r) => r.workout === 'Floor is Lava' && r.endedAt >= since,
						);
					},
					{ crew: opened.crew, since },
				),
			{
				message: 'the game left no recap on the crew',
				timeout: 15_000,
			},
		)
		.toBe(true);
});
