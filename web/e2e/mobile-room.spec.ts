import { expect, test } from './room';
import { signInAs } from './signin';

/**
 * A phone runs the room shell, not the retired spectator redirect (#412).
 * Keep one small-viewport walk here: the desktop suite cannot notice a drawer
 * that never opens or a Chat place that becomes unreachable below `md`.
 */
test('a phone opens a room lounge and reaches its chat place', async ({
	page,
	rooms,
}) => {
	await signInAs(page, 'Mobile Room', '/rooms');
	const name = `Mobile Room ${Date.now() % 100000}`;
	const { slug } = await rooms.open(page, name);

	await expect(page).toHaveURL(new RegExp(`/r/${slug}$`));
	await expect(page.getByRole('heading', { name })).toBeVisible();

	await page.getByRole('button', { name: 'open navigation' }).click();
	const chat = page.locator(`a[href="/r/${slug}/chat"]`).first();
	await expect(chat).toBeVisible();
	await chat.click();

	await expect(page).toHaveURL(new RegExp(`/r/${slug}/chat$`));
	await expect(page.getByTestId('thread-log')).toBeVisible();
});
