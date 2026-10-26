import { expect, test } from './crew';
import { COUNTDOWN_MS, NEUTRAL_MS, raceARoad } from './race';

/**
 * The RACE page and the team-car radio (#3174): two riders race the coach's
 * road on simulated trainers, started from the session picker (#3777).
 * Through the neutral zone the page has no par yet and the radio calls it;
 * from km 0 the page reads the gap to par, the rider's place in their
 * Category, and the radio says the race is on.
 */
test('a race shows its RACE page and calls it on the team-car radio', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);
	test.setTimeout(COUNTDOWN_MS + NEUTRAL_MS + 180_000);
	const coach = await riders('Race Page Coach');
	const guest = await riders('Race Page Guest');
	await raceARoad(coach, [guest], channels);

	for (const page of [coach, guest]) {
		// Under way: the flag has dropped and the radio has made its first call.
		await expect(page.getByTestId('race-radio')).toBeVisible({
			timeout: COUNTDOWN_MS + 30_000,
		});
		// Docked, the arrows name the page they turn to (D15); RACE is last, so
		// ← from RIDE reaches it.
		await page.getByRole('button', { name: 'previous page, RACE' }).click();
		await expect(page.getByTestId('bike-computer')).toHaveAttribute(
			'data-page',
			'race',
		);
	}
	const par = coach.locator('[data-field="par"]');
	const radio = coach.getByTestId('race-radio');
	// The neutral zone: no par to measure yet, and the radio says where it is.
	await expect(par).toContainText('—');
	await expect(radio).toContainText('Neutral zone.');

	// From km 0: the gap to par, a place among two — and the call.
	await expect(par).toContainText(/[+−]\d+:\d\d/, {
		timeout: NEUTRAL_MS + 30_000,
	});
	await expect(coach.locator('[data-field="place"]')).toContainText(
		/in [A-D]\s*(1st|2nd) of 2/,
	);
	await expect(radio).toContainText(/km 0\. Race on\.|to the line\./, {
		timeout: 30_000,
	});
});
