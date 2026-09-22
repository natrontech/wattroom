import { expect, test } from './room';
import { signInAs } from './signin';

/**
 * The golden onboarding path (#122, #2480): a fresh account starts its crew
 * on Home, lands in it with a text and a voice channel, and opens a room
 * there from the crew's own page. This exact flow shipped hard-broken once —
 * the create form only rendered when the room list was non-empty, so the
 * empty state's CTAs focused inputs that did not exist.
 */
test('a fresh user starts their first crew through the UI', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Smoke Crew Owner', '/home');

	const name = `Smoke Test Crew ${Date.now() % 100000}`;
	await page.locator('#start-crew-name').fill(name);
	await page
		.locator('#rooms')
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

	// Somewhere to ride until the voice channel has a page of its own: the
	// crew's first room, from its own page. The room's teardown takes the
	// crew with it — nobody else is in it (#1935).
	await page.getByRole('button', { name: 'Open a room here' }).first().click();
	const sheet = page.getByRole('dialog', { name: 'Open a room' });
	await sheet.locator('#open-room-name-sheet').fill(name);
	await sheet.getByRole('button', { name: 'Open a room' }).click();
	await page.waitForURL(/\/r\//, { timeout: 15_000 });
	rooms.adopt(page, page.url().split('/r/')[1].split(/[/?#]/)[0]);
	await expect(page.getByRole('heading', { name })).toBeVisible({
		timeout: 15_000,
	});
});

/**
 * /rooms is retired (ADR-0020): the sidebar is the room list. The stub
 * stays so shared links still land — on Home's door, not on a 404.
 */
test('the retired /rooms link lands on the door', async ({ page }) => {
	await signInAs(page, 'Smoke Crew Owner', '/rooms');
	await expect(page).toHaveURL(/\/home#rooms$/);
	await expect(page.locator('#start-crew-name')).toBeVisible();
});
