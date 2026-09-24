import { expect, test, voicePath, type OpenedChannels } from './crew';
import type { Page } from '@playwright/test';

/**
 * The crew's owner drags a rider's name from one voice channel onto another,
 * Discord's move (#2730), and the rider's own page goes there and says who
 * moved them. The rider is only on the page, so no call is needed.
 */
const OWNER = 'Move Owner';
const RIDER = 'Move Rider';

const rowOf = (page: Page, opened: OpenedChannels) =>
	page
		.getByRole('navigation', { name: 'crews and channels' })
		.locator(`a[href="${voicePath(opened)}"]`);

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

	await owner
		.getByRole('button', { name: `Show who is in ${one.name}` })
		.click({ timeout: 15_000 });
	const name = owner
		.getByRole('list', { name: `Who is in ${one.name}` })
		.getByRole('listitem')
		.filter({ hasText: RIDER });
	await name.dragTo(rowOf(owner, two));

	await expect(rider, 'the moved rider stayed where they were').toHaveURL(
		new RegExp(`${voicePath(two)}$`),
		{ timeout: 15_000 },
	);
	await expect(
		rider.getByText(`${OWNER} moved you to ${two.name}.`),
	).toBeVisible();
	await expect(
		owner.getByRole('list', { name: `Who is in ${one.name}` }),
		'the owner still sees them in the channel they left',
	).toHaveCount(0, { timeout: 15_000 });
});
