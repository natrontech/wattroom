import { expect, test } from './crew';
import { signInAs } from './signin';

/**
 * Start now on a planned session runs it (#2535): the plan's workout counts
 * down in the plan's voice channel with the starter coaching. It used to be
 * picked and left idle, with the plan already marked started and gone.
 */
test('Start now on a plan counts it down in its voice channel', async ({
	page,
	channels,
	schedules,
}) => {
	await signInAs(page, 'Plan Starter', '/home');
	const stamp = Date.now() % 100000;
	const { crew, voice } = await channels.open(page, `Plan Start ${stamp}`);
	await schedules.own(page, crew);

	const workoutName = `Thursday ${stamp}`;
	const planned = await page.evaluate(
		async ({ crew, voice, workoutName }) => {
			const res = await fetch(`/api/crews/${crew}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName,
					workoutJson: JSON.stringify({
						name: workoutName,
						steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
					}),
					// Due: Start now is offered within 15 minutes of the start.
					startsAt: new Date(Date.now() + 5 * 60_000).toISOString(),
					channelId: voice,
				}),
			});
			return res.status;
		},
		{ crew, voice, workoutName },
	);
	expect(planned).toBeLessThan(300);

	await page.goto(`/crew/${crew}/schedule`);
	await page.getByRole('button', { name: 'Start now' }).first().click();

	// The crew's live read is what every sidebar draws a session from.
	await expect
		.poll(
			() =>
				page.evaluate(
					async ({ crew, voice }) => {
						const { crews } = (await fetch('/api/crews/live').then((res) =>
							res.json(),
						)) as {
							crews: {
								id: string;
								channels: {
									id: string;
									session?: { workout: string; phase: string };
								}[];
							}[];
						};
						const session = crews
							.find((c) => c.id === crew)
							?.channels.find((c) => c.id === voice)?.session;
						return session ? `${session.workout} ${session.phase}` : 'none';
					},
					{ crew, voice },
				),
			{ message: 'the plan never ran in its voice channel', timeout: 15_000 },
		)
		.toMatch(new RegExp(`^${workoutName} (countdown|running)$`));
});
