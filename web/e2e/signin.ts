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
	// This same spec is the operator's pre-deploy gate against production, in a
	// real browser. Anything that renders over the app there fails the rollout
	// and rolls it back — which is why the email gate exempts an account whose
	// only identity is synthetic (#822, $lib/account/verify-prompt).
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
 * docs/SPEC.md caps how many crews a rider founds and how many channels a
 * crew holds. Playwright runs the specs in parallel, so specs opening channels
 * as the one dev rider all land in one crew and race for its caps: whichever
 * loses is refused, and reads as the button doing nothing (#594, when the cap
 * was three rooms). Giving each spec its own owner removes the contention
 * instead of serialising the suite, which would cost more than the specs are
 * worth.
 *
 * The name must be stable rather than random — a fresh identity per run would
 * grow a user table forever. One rider per spec, reused, founding one crew and
 * keeping it; the channels it opens there, the `channels` fixture takes back.
 *
 * `?as=` is the dev provider's own door (#409) and exists only where
 * WATTROOM_DEV_LOGIN is set. A deployed target has the single synthetic
 * identity and no parallel channel specs, so it falls back to the ordinary
 * path.
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
