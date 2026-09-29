import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * "Sign out everywhere else" ends the other sessions and leaves personal
 * tokens alone (#2902, ADR-0017): a coach's tooling must not stop without
 * warning. So its result shows the tokens that survived, each with the
 * Revoke Coach access has — a rider signing out after a borrowed session
 * sees at once whether that session left a way back in.
 */
test('signing out everywhere else lists the tokens it left, each with Revoke', async ({
	page,
}) => {
	await signInAs(page, 'Token Survivor', '/settings/profile');
	const minted = await page.request.post('/api/tokens', {
		data: { name: 'Borrowed laptop' },
	});
	expect(minted.ok()).toBe(true);

	await page.getByRole('button', { name: 'Sign out everywhere else' }).click();
	await expect(page.getByTestId('surviving-tokens')).toBeVisible();
	const row = page.getByRole('listitem').filter({ hasText: 'Borrowed laptop' });
	await expect(row).toBeVisible();

	// Revoke asks first, as it does on Coach access: it stops tooling someone
	// else may run, and there is no undo.
	await row.getByRole('button', { name: 'Revoke' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Revoke' })
		.click();
	await expect(row).toHaveCount(0);
	const left = await page.request.get('/api/tokens');
	expect((await left.json()).tokens).toEqual([]);
});
