import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * The passkey ceremony end to end (#824): navigator.credentials.create and
 * .get against go-webauthn's verification. Neither side's unit tests reach
 * this — each has to stand in for the other — so until now it had never run
 * against a real authenticator. Chromium's virtual authenticator over CDP is
 * the phone or the key here: discoverable credentials (the server requires a
 * resident key), user verification on, presence simulated, so the whole flow
 * runs without a hand on a button.
 */
test('a passkey registers, and signs the rider back in where they were going', async ({
	page,
}) => {
	test.skip(
		!!process.env.WATTROOM_SYNTHETIC_TOKEN,
		'the production synthetic has no virtual authenticator, and must not mint passkeys',
	);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});

	await signInAs(page, 'Passkey Rider', '/profile');
	const name = `virtual ${Date.now() % 100000}`;
	await page.getByPlaceholder('Phone, YubiKey…').fill(name);
	await page.getByRole('button', { name: 'Add a passkey' }).click();
	const row = page.getByRole('listitem').filter({ hasText: name });
	await expect(row).toBeVisible();
	await expect(row).toContainText('never used');

	// Out, and back in with nothing but the key — landing where the link
	// pointed, not on /rooms (#824).
	await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
	await page.goto('/login?next=%2Fprofile');
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page).toHaveURL(/\/profile$/);
	await expect(row).toBeVisible();
	await expect(row).toContainText('last used');

	// The rider is reused across runs (signin.ts): take the key back so the
	// list does not grow by one per run. The dev identity keeps them in.
	await row.getByRole('button', { name: 'Remove' }).click();
	await expect(row).toBeHidden();
});
