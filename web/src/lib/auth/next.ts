/**
 * Deep-link survival across the OAuth round-trip: /login stashes the target,
 * the provider bounces through the server and lands back on "/", and the
 * signed-in redirect picks the stash up. Same-origin paths only — "//host"
 * and full URLs are open redirects and are dropped.
 */
const KEY = 'wattroom.login.next';

export function rememberNext(path: string | null): void {
	try {
		if (path && path.startsWith('/') && !path.startsWith('//')) {
			sessionStorage.setItem(KEY, path);
		} else {
			sessionStorage.removeItem(KEY);
		}
	} catch {
		// blocked storage: the rider just lands on /rooms instead
	}
}

export function takeNext(): string | null {
	try {
		const path = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
		return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
	} catch {
		return null;
	}
}
