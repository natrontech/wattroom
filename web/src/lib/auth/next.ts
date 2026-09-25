/**
 * Deep-link survival across the OAuth round-trip: /login stashes the target,
 * the provider bounces through the server and lands back on "/", and the
 * signed-in redirect picks the stash up. Same-origin paths only — "//host"
 * and full URLs are open redirects and are dropped.
 */
import { sameOriginPath } from '$lib/same-origin';

const KEY = 'wattroom.login.next';

export function rememberNext(path: string | null): void {
	try {
		if (sameOriginPath(path)) {
			sessionStorage.setItem(KEY, path);
		} else {
			sessionStorage.removeItem(KEY);
		}
	} catch {
		// blocked storage: the rider just lands on /home instead
	}
}

/**
 * Where a signed-in landing on "/" goes with nothing stashed (#2144): the
 * crew's door the rider was sent to and has not joined; else the crew the
 * sidebar opens in (`chosen` — the main crew, else this device's last,
 * #2576), while the rider is still in it; else Home. The stash lives in one
 * tab, and a new account's email confirmation opens another — so the invite
 * follows the account instead (`/api/me`'s `pendingInvite`).
 */
export function landing(
	pendingInvite?: string | null,
	chosen?: string | null,
	crews: { id: string }[] = [],
): string {
	if (pendingInvite) return `/c/${pendingInvite}`;
	return crews.some((c) => c.id === chosen) ? `/crew/${chosen}` : '/home';
}

export function takeNext(): string | null {
	try {
		const path = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
		return sameOriginPath(path) ? path : null;
	} catch {
		return null;
	}
}
