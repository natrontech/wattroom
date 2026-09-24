import { expect, test, voicePath, type OpenedChannels } from './crew';
import type { Page } from '@playwright/test';

/**
 * The crew's owner drags a rider's name from one voice channel onto another,
 * Discord's move (#2730), and the rider's own page goes there and says who
 * moved them. The rider is only on the page, so no call is needed. The list
 * the name is dragged from carries the rider's status (#2745).
 */
const OWNER = 'Move Owner';
const RIDER = 'Move Rider';
const REFUSER = 'Refuse Owner';
const STAYER = 'Refuse Rider';

const rowOf = (page: Page, opened: OpenedChannels) =>
	page
		.getByRole('navigation', { name: 'crews and channels' })
		.locator(`a[href="${voicePath(opened)}"]`);

const listOf = (page: Page, opened: OpenedChannels) =>
	page.getByRole('list', { name: `Who is in ${opened.name}` });

test('an owner drags a rider into another voice channel', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const owner = await riders(OWNER);
	await owner.setViewportSize({ width: 1440, height: 900 });
	const n = Date.now() % 100000;
	const one = await channels.open(owner, `Move One ${n}`);
	const two = await channels.open(owner, `Move Two ${n}`);
	const rider = await riders(RIDER);
	await channels.enter(rider, one);
	const set = await rider.evaluate(() =>
		fetch('/api/me/status', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ emoji: '🚴', text: 'Base miles' }),
		}).then((res) => res.status),
	);
	expect(set, 'the rider could not set a status').toBeLessThan(300);

	await owner
		.getByRole('button', { name: `Show who is in ${one.name}` })
		.click({ timeout: 15_000 });
	const name = listOf(owner, one)
		.getByRole('listitem')
		.filter({ hasText: RIDER });
	await expect(name, 'the unfolded list left out the status').toContainText(
		'Base miles',
		{ timeout: 15_000 },
	);
	await name.dragTo(rowOf(owner, two));

	await expect(rider, 'the moved rider stayed where they were').toHaveURL(
		new RegExp(`${voicePath(two)}$`),
		{ timeout: 15_000 },
	);
	await expect(
		rider.getByText(`${OWNER} moved you to ${two.name}.`),
	).toBeVisible();
	await expect(
		listOf(owner, one),
		'the owner still sees them in the channel they left',
	).toHaveCount(0, { timeout: 15_000 });
});

test('a refused move goes back where it came from, with the reason', async ({
	riders,
	channels,
}) => {
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		'the ?as= dev provider only exists on a dev server',
	);

	const owner = await riders(REFUSER);
	await owner.setViewportSize({ width: 1440, height: 900 });
	const n = Date.now() % 100000;
	const one = await channels.open(owner, `Stay One ${n}`);
	const two = await channels.open(owner, `Stay Two ${n}`);
	const rider = await riders(STAYER);
	await channels.enter(rider, one);

	// The hub's own refusal for a pedalling rider, without a trainer.
	const reason =
		'They are riding, and a move would end their ride. Try again once they stop pedalling.';
	await owner.route('**/api/channels/*/move', (route) =>
		route.fulfill({
			status: 409,
			contentType: 'application/json',
			body: JSON.stringify({ error: 'conflict', message: reason }),
		}),
	);

	await owner
		.getByRole('button', { name: `Show who is in ${one.name}` })
		.click({ timeout: 15_000 });
	await listOf(owner, one)
		.getByRole('listitem')
		.filter({ hasText: STAYER })
		.dragTo(rowOf(owner, two));

	await expect(owner.getByText(reason)).toBeVisible();
	await expect(
		listOf(owner, one),
		'the refused name did not come back',
	).toContainText(STAYER);
	await expect(
		owner.locator(`[data-voice-drop="${two.voice}"]`),
		'the refused name stayed where it was dropped',
	).not.toContainText(STAYER);
	await expect(rider, 'a refused move moved the rider').toHaveURL(
		new RegExp(`${voicePath(one)}$`),
	);
});
