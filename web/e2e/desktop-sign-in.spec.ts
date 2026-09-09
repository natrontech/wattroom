import { expect, test } from '@playwright/test';
import { signInAs } from './signin';

/**
 * Signing in from the desktop shell goes through the browser (#1188,
 * ADR-0040). Both halves against the real server: the browser mints a
 * handoff for the nonce in its query, and the shell redeems it with the nonce
 * it kept and ends up signed in on a session of its own.
 */
const NONCE = 'e2e-desktop-nonce-0123456789abcdef';

test('the browser half: signed in with ?desktop=, it hands the session to the app', async ({
	page,
}) => {
	const minted = page.waitForResponse('**/api/auth/desktop/handoff');
	await signInAs(page, 'Desktop Handoff', `/login?desktop=${NONCE}`);
	expect((await minted).status()).toBe(200);

	await expect(
		page.getByText('You are signed in. Back to the WattRoom app.'),
	).toBeVisible();
	const link = page.getByRole('link', { name: 'Open WattRoom' });
	await expect(link).toHaveAttribute(
		'href',
		/^wattroom:\/\/auth\/[A-Za-z0-9_-]{20,}$/,
	);
	// It stays on the page: a browser without the app installed shows nothing
	// for the scheme, and the rider still needs the way out.
	await expect(
		page.getByRole('link', { name: 'wattroom.ch/download' }),
	).toBeVisible();
});

test('the shell half: /login?handoff=<token> redeems with the kept nonce and signs in', async ({
	page,
	context,
}) => {
	// A token, minted the way the browser would.
	await signInAs(page, 'Desktop Redeem', '/home');
	const res = await page.request.post('/api/auth/desktop/handoff', {
		data: { nonce: NONCE },
	});
	expect(res.status()).toBe(200);
	const { token } = (await res.json()) as { token: string };

	// Now be the shell: no session, the nonce in storage, window.wattroom present.
	await context.clearCookies();
	await page.addInitScript((nonce) => {
		Object.assign(window, {
			wattroom: { version: '2026.09.3', platform: 'darwin' },
		});
		localStorage.setItem('wattroom.desktop-signin.v1', nonce);
	}, NONCE);

	await page.goto(`/login?handoff=${token}`);
	// Redeemed: the shell is signed in and lands where a fresh sign-in lands.
	await expect(page).toHaveURL(/\/(home|rooms)(#.*)?$/);
	const me = await page.evaluate(() =>
		fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
	);
	expect(me?.displayName).toBe('Desktop Redeem');

	// The link is single-use: the same token again is refused, and the page says so.
	await context.clearCookies();
	await page.goto(`/login?handoff=${token}`);
	await expect(
		page.getByText(/stale or was meant for another app/),
	).toBeVisible();
});

test('the shell half, no sign-in yet: one button, and it goes to the browser', async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.assign(window, {
			wattroom: { version: '2026.09.3', platform: 'darwin' },
		});
	});
	await page.goto('/login');
	await expect(
		page.getByRole('button', { name: 'Sign in with your browser' }),
	).toBeVisible();
	// No passkey and no provider buttons inside the shell.
	await expect(page.getByText('Sign in with a passkey')).toHaveCount(0);
	// ...including the dev provider, which is what the dev server offers.
	await expect(
		page.getByText(/Continue with|Connect with|Dev sign-in/),
	).toHaveCount(0);

	const popup = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Sign in with your browser' }).click();
	const opened = await popup;
	expect(opened.url()).toMatch(/\/login\?desktop=[A-Za-z0-9]{32}$/);
	await expect(page.getByText('Waiting for your browser…')).toBeVisible();
});
