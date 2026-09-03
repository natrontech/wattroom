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

/**
 * Sign in as a rider belonging to this spec alone, then land on `path`.
 *
 * docs/SPEC.md caps a rider at three owned rooms, and the cap counts per
 * owner. Playwright runs the specs in parallel, so four specs opening a room
 * as the one dev rider is four rooms against a cap of three: whichever loses
 * the race sees "Open room" disabled and reads as the button doing nothing
 * (#594). Giving each spec its own owner removes the contention instead of
 * serialising the suite, which would cost more than the specs are worth.
 *
 * The name must be stable rather than random — a fresh identity per run would
 * grow a user table forever. One rider per spec, reused, owning one room at a
 * time that the `rooms` fixture takes back.
 *
 * `?as=` is the dev provider's own door (#409) and exists only where
 * WATTROOM_DEV_LOGIN is set. A deployed target has the single synthetic
 * identity and no parallel room specs, so it falls back to the ordinary path.
 */
export async function signInAs(
	page: Page,
	as: string,
	path: string,
): Promise<void> {
	if (process.env.WATTROOM_SYNTHETIC_TOKEN) return signInTo(page, path);
	await page.goto(`/api/auth/dev/start?as=${encodeURIComponent(as)}`);
	const me = await page.evaluate(() =>
		fetch('/api/me').then((res) => (res.ok ? res.json() : null)),
	);
	if (me?.displayName !== as)
		throw new Error(
			`?as=${as} did not mint this spec's own rider — is WATTROOM_DEV_LOGIN set on this server?`,
		);
	await page.goto(path);
}
