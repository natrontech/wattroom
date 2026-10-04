import type { Locator, Page } from '@playwright/test';
import { voicePath, type DesignCrew } from './seed';

/**
 * A crew session in Designer's voice channel, two riders on simulated
 * trainers (#3666): started from the session picker, joined, and ended to its
 * summary, the way summary-survives.spec.ts rides one.
 */

/**
 * A click from inside the page: the session picker is a modal whose buttons
 * Playwright resolves, finds stable, and then cannot scroll to.
 */
async function press(control: Locator): Promise<void> {
	await control.waitFor();
	await control.evaluate((el) => (el as HTMLElement).click());
}

/** Pairs this rider's simulated trainer in the channel's Training place. */
export async function toTraining(page: Page, crew: DesignCrew): Promise<void> {
	await page.goto(`${voicePath(crew)}/training`);
	await page
		.getByRole('button', { name: 'Ride simulated' })
		.first()
		.click({ timeout: 15_000 });
}

/** Starts a library workout for the channel, or rides a road together. */
export async function startSession(
	coach: Page,
	pick: { workout: string } | { road: string },
): Promise<void> {
	await coach.getByRole('button', { name: 'Start a session' }).click();
	const picker = coach.getByRole('dialog', { name: 'Start a session' });
	if ('workout' in pick) {
		await picker
			.getByRole('textbox', { name: 'find a workout' })
			.fill(pick.workout);
		await press(
			picker.getByRole('button', { name: new RegExp(pick.workout) }).first(),
		);
		// A coach whose trainer is still on the channel's free ride is offered
		// "Start without a trainer" instead, as the road branch below allows.
		await press(
			picker.getByRole('button', {
				name: new RegExp(`^Start (${pick.workout}|without a trainer)$`),
			}),
		);
	} else {
		await press(picker.getByRole('button', { name: 'Roads', exact: true }));
		// Pick the road's row; the crew rides its own workout, started from
		// the picker's footer like any other.
		await press(
			picker
				.getByRole('list', { name: 'your routes' })
				.getByRole('listitem')
				.filter({ hasText: pick.road })
				.getByRole('button', { name: 'Pick' })
				.first(),
		);
		await press(picker.getByRole('button', { name: /^Start / }).last());
	}
}

/** The second rider rides along. */
export async function joinSession(rider: Page): Promise<void> {
	await rider
		.getByRole('link', { name: 'Join the ride' })
		.click({ timeout: 20_000 });
}

/** Ends the session from the coach's seat; the summary follows a minute ridden. */
export async function endSession(coach: Page): Promise<void> {
	await coach.getByRole('button', { name: 'end the session' }).click();
	await coach
		.getByRole('dialog')
		.getByRole('button', { name: 'End the session' })
		.click();
}
