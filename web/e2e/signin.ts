import type { Page } from '@playwright/test';

/**
 * Everything is behind sign-in (ADR-0009), so every flow enters like a rider:
 * hit the deep link, get bounced to /login, take the dev provider, land back
 * where we were going. The bounce itself is part of what this exercises.
 */
export async function signInTo(page: Page, path: string): Promise<void> {
	// Against a deployed target the dev provider does not exist — it is an
	// unauthenticated door and production never sets WATTROOM_DEV_LOGIN. The
	// synthetic monitor carries a bearer instead (#153); the POST runs through
	// the page's context, so the session cookie lands where the browser needs it.
	const token = process.env.WATTROOM_SYNTHETIC_TOKEN;
	if (token) {
		const res = await page.request.post('/api/auth/synthetic', {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok()) throw new Error(`synthetic sign-in failed: ${res.status()}`);
		await page.goto(path);
		return;
	}
	await page.goto(path);
	await page
		.getByRole('button', { name: /Dev sign-in/ })
		.click({ timeout: 15_000 });
}
