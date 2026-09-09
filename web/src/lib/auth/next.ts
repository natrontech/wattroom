/**
 * Deep-link survival across the OAuth round-trip: /login stashes the target,
 * the provider bounces through the server and lands back on "/", and the
 * signed-in redirect picks the stash up. Same-origin paths only — "//host"
 * and full URLs are open redirects and are dropped.
 */
const KEY = 'wattroom.login.next';

/**
 * Same-origin, positively (#1610): "/\\evil.com" passed the two prefix
 * checks and the URL parser folds the backslash, so it resolved off-site.
 * Parsing it the way the browser will is the only check that agrees with
 * the browser.
 */
export function sameOriginPath(
	path: string | null | undefined,
): path is string {
	if (!path || !path.startsWith('/')) return false;
	// The tests run under node, where there is no location; any origin
	// serves, since the check is "did the parser keep it on that origin".
	const origin =
		typeof location === 'undefined'
			? 'http://wattroom.invalid'
			: location.origin;
	try {
		const url = new URL(path, origin);
		return url.origin === origin && url.href.startsWith(origin + '/');
	} catch {
		return false;
	}
}

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

export function takeNext(): string | null {
	try {
		const path = sessionStorage.getItem(KEY);
		sessionStorage.removeItem(KEY);
		return sameOriginPath(path) ? path : null;
	} catch {
		return null;
	}
}
