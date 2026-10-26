import type { Page } from '@playwright/test';
import { expect, voicePath, type ChannelOwner } from './crew';
import { climbGpx } from './road-gpx';

/** The race's countdown to the flag. */
export const COUNTDOWN_MS = 10_000;
/** docs/spec/races.md "Start": three minutes of neutral zone, then the km-0 klaxon. */
export const NEUTRAL_MS = 180_000;

/**
 * The coach saves the invented climb to their routes, opens a voice channel
 * the guests stand in, and races the road from the session picker (#3777;
 * ADR-0067: a race opens its own session on a road), every one of them on
 * the simulated trainer. The field freezes at the flag, so the guests line
 * up in the countdown.
 */
export async function raceARoad(
	coach: Page,
	guests: Page[],
	channels: ChannelOwner,
): Promise<void> {
	const NAME = `Race road ${Date.now() % 100000}`;
	await coach.goto('/workouts/import');
	await coach.locator('input[type=file]').setInputFiles({
		name: 'climb.gpx',
		mimeType: 'application/gpx+xml',
		buffer: Buffer.from(climbGpx()),
	});
	await coach.getByLabel('your name for it').fill(NAME);
	await coach.getByRole('button', { name: 'Save to my routes' }).click();
	await expect(coach.getByText(`“${NAME}” is on your routes`)).toBeVisible();
	const routeId = await coach.evaluate(async (name) => {
		const { routes } = (await (await fetch('/api/routes')).json()) as {
			routes: { id: string; name: string }[];
		};
		return routes.find((r) => r.name === name)?.id ?? '';
	}, NAME);
	expect(routeId, 'the imported road is on the coach’s routes').toBeTruthy();

	const opened = await channels.open(coach, `Race ${Date.now() % 100000}`);
	for (const guest of guests) await channels.enter(guest, opened);
	for (const page of [coach, ...guests]) {
		await page.goto(`${voicePath(opened)}/training`);
		await page
			.getByRole('button', { name: 'Ride simulated' })
			.click({ timeout: 15_000 });
	}
	// Roads, the road, Race it, and the race to the line it opens on.
	await coach
		.getByRole('button', { name: 'Start a session' })
		.click({ timeout: 15_000 });
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	await picker.getByRole('button', { name: 'Roads' }).click();
	await picker
		.getByRole('list', { name: 'your routes' })
		.getByRole('listitem')
		.filter({ hasText: NAME })
		.getByRole('button', { name: 'Pick' })
		.click();
	await picker.getByRole('button', { name: 'Race it' }).click();
	await expect(
		picker
			.getByRole('group', { name: 'which race' })
			.getByRole('button', { name: /^Race / }),
	).toHaveAttribute('aria-pressed', 'true');
	await picker.getByRole('button', { name: 'Start Race' }).click();
	await expect(
		coach.getByRole('button', { name: 'end the session' }),
	).toBeVisible();
	for (const guest of guests)
		await guest
			.getByRole('link', { name: 'Join the ride' })
			.click({ timeout: COUNTDOWN_MS });
}
