import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The golden onboarding path (#122, #2480): a fresh account starts its crew
 * on Home and lands in it with a text and a voice channel. This exact flow
 * shipped hard-broken once — the create form only rendered when the room
 * list was non-empty, so the empty state's CTAs focused inputs that did not
 * exist.
 */
test('a fresh user starts their first crew through the UI', async ({
	page,
}) => {
	// Fresh for real: the crew a run founds is never swept — a crew with
	// channels is not empty (#2493) — so the last run's rider, and the crew
	// only they were in, go first. Deleting the account is SPEC's one way a
	// crew ends, and it keeps a failed run from counting against the cap.
	await signInAs(page, 'Smoke Crew Owner', '/home');
	const purged = await page.evaluate(() =>
		fetch('/api/me', { method: 'DELETE' }).then((res) => res.status),
	);
	expect(purged, 'could not start from a fresh rider').toBeLessThan(300);
	await signInAs(page, 'Smoke Crew Owner', '/home');

	const name = `Smoke Test Crew ${Date.now() % 100000}`;
	await page.locator('#start-crew-name').fill(name);
	await page
		.locator('#crews')
		.getByRole('button', { name: 'Start a crew', exact: true })
		.click();
	await page.waitForURL(/\/crew\/[0-9a-f-]+$/, { timeout: 15_000 });
	const crewId = page.url().split('/crew/')[1];
	await expect(page.getByRole('heading', { name })).toBeVisible();

	const channels = await page.evaluate(
		(id) =>
			fetch(`/api/crews/${id}/channels`)
				.then((res) => res.json())
				.then((body: { channels: { kind: string; name: string }[] }) =>
					body.channels.map((c) => `${c.kind}:${c.name}`),
				),
		crewId,
	);
	expect(channels).toEqual(['text:Lounge', 'voice:Lounge']);
});

/**
 * /rooms is retired twice (ADR-0020, then ADR-0058): what it listed is crews
 * now, and the list of those is the directory. The stub stays so shared links
 * still land — on the directory, not on a 404.
 */
test('/rooms lands on the crew directory', async ({ page }) => {
	await signInAs(page, 'Smoke Crew Owner', '/rooms');
	await expect(page).toHaveURL(/\/crews\/directory$/);
	await expect(
		page.getByRole('heading', { name: 'Find a crew', level: 1 }),
	).toBeVisible();
});
