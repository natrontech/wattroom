import { expect, test } from './crew';

/**
 * The crew's Home (#2451, ADR-0058): quiet, it teaches — where to start the
 * first ride; with a plan on the calendar, the plan is there and answering it
 * takes one tap, asserted against the server rather than the button.
 */

/** This spec's own rider — nobody else's (#2133). */
const A = 'Crew Home Owner';

test('crew Home teaches when quiet, and a plan is answered from it', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const a = await riders(A);
	const { crew } = await channels.open(a, `Crew Home ${Date.now() % 100000}`);

	await a.goto(`/crew/${crew}`);
	const start = a.getByRole('link', { name: /^Go to / });
	await expect(start).toBeVisible({ timeout: 15_000 });
	await expect(start).toHaveAttribute(
		'href',
		new RegExp(`^/crew/${crew}/v/[0-9a-f-]+$`),
	);

	const workoutName = `Home Plan ${Date.now() % 100000}`;
	const planned = await a.evaluate(
		async ([id, name]) => {
			const res = await fetch(`/api/crews/${id}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName: name,
					workoutJson: JSON.stringify({
						name,
						steps: [{ type: 'steady', seconds: 600, target: 0.75 }],
					}),
					startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
				}),
			});
			return res.status;
		},
		[crew, workoutName] as const,
	);
	expect(planned, 'could not plan a session').toBe(201);

	await a.reload();
	await expect(a.getByText(workoutName)).toBeVisible({ timeout: 15_000 });
	// A plan is something happening: the quiet crew's lesson steps aside.
	await expect(a.getByRole('link', { name: /^Go to / })).toHaveCount(0);

	await a.getByRole('button', { name: "I'm in" }).click();
	await expect
		.poll(() =>
			a.evaluate(
				(id) =>
					fetch(`/api/crews/${id}/schedule`)
						.then((res) => res.json())
						.then(
							(body: { sessions: { yourAnswer?: string }[] }) =>
								body.sessions[0]?.yourAnswer,
						),
				crew,
			),
		)
		.toBe('in');
	await expect(a.getByRole('button', { name: "I'm in" })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(a.getByText(`1 in — ${A}`)).toBeVisible();

	// The plan's name leads to its own row on the Schedule, marked (#2608).
	await a.getByRole('link', { name: workoutName }).click();
	await a.waitForURL(new RegExp(`/crew/${crew}/schedule#plan-[0-9a-f-]+$`));
	await expect(
		a.getByRole('listitem').filter({ hasText: workoutName }),
	).toHaveAttribute('aria-current', 'true');

	// Cancelled so a second run starts from the same quiet crew.
	await a.evaluate(async (id) => {
		const body = await fetch(`/api/crews/${id}/schedule`).then((res) =>
			res.json(),
		);
		for (const plan of body.sessions as { id: string }[])
			await fetch(`/api/crews/${id}/schedule/${plan.id}`, { method: 'DELETE' });
	}, crew);
});
