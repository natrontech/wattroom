import type { Page } from '@playwright/test';
import { expect, test, voicePath } from './crew';

/**
 * A voice channel shows the plan due in it (#2606). The reminder mail and the
 * calendar event link there, and since M9 it said nothing about the plan; a
 * session started there left the plan unmarked, so the Schedule's Start now
 * went on offering itself against the session it had become.
 */
const RIDER = 'Plan Here Coach';

/** A plan in the channel, `minutes` from now — inside Start now's window. */
async function planIn(
	page: Page,
	crew: string,
	channel: string,
	workoutName: string,
	minutes: number,
): Promise<void> {
	const status = await page.evaluate(
		async ({ crew, channel, workoutName, minutes }) => {
			const res = await fetch(`/api/crews/${crew}/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					workoutName,
					workoutJson: JSON.stringify({
						name: workoutName,
						steps: [{ type: 'steady', seconds: 600, target: 0.6 }],
					}),
					startsAt: new Date(Date.now() + minutes * 60_000).toISOString(),
					channelId: channel,
				}),
			});
			return res.status;
		},
		{ crew, channel, workoutName, minutes },
	);
	expect(status, `could not plan ${workoutName}`).toBe(201);
}

test('the voice channel shows its plan, answers it and starts it', async ({
	riders,
	channels,
	schedules,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const page = await riders(RIDER);
	const opened = await channels.open(page, `Plan Here ${Date.now() % 100000}`);
	// The rider's crew outlives the test; its calendar starts empty.
	await schedules.own(page, opened.crew);
	await planIn(page, opened.crew, opened.voice, 'Card Spin', 5);
	await planIn(page, opened.crew, opened.voice, 'Card Later', 10);

	// The soonest plan in this channel, on the channel's own page.
	await page.goto(voicePath(opened));
	const card = page.getByRole('region', { name: 'planned here' });
	await expect(card.getByText('Card Spin')).toBeVisible({ timeout: 15_000 });

	// Answered where it is shown.
	await card.getByRole('button', { name: "I'm in" }).click();
	await expect(card.getByRole('button', { name: "I'm in" })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(card.getByText(`1 in — ${RIDER}`)).toBeVisible();

	// Started from the card — unpaired, so it says so (#2594) — and the
	// session is the plan's.
	await card.getByRole('button', { name: 'Start without a trainer' }).click();
	await expect(
		page
			.getByRole('button', { name: 'Stop the countdown' })
			.or(page.getByRole('button', { name: 'end the session' })),
	).toBeVisible({ timeout: 15_000 });

	// The plan is marked: it no longer offers itself; the other one still does.
	// This channel's plans only: the rider's crew outlives the test, and so
	// do earlier runs' plans.
	const listed = await page.evaluate(
		async ({ crew, voice }) => {
			const res = await fetch(`/api/crews/${crew}/schedule`);
			const { sessions } = (await res.json()) as {
				sessions: { workoutName: string; channelId?: string }[];
			};
			return sessions
				.filter((s) => s.channelId === voice)
				.map((s) => s.workoutName);
		},
		{ crew: opened.crew, voice: opened.voice },
	);
	expect(listed).toEqual(['Card Later']);

	// And the Schedule's Start now stands down while the channel is taken,
	// naming who holds it, rather than a button the hub would refuse.
	await page.goto(`/crew/${opened.crew}/schedule`);
	const later = page
		.getByRole('listitem')
		.filter({ hasText: `${RIDER} is coaching in ${opened.name}` });
	await expect(later).toBeVisible({ timeout: 15_000 });
	await expect(later.getByRole('button', { name: 'Start now' })).toHaveCount(0);
});
