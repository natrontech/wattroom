/**
 * Same-origin, positively (#1610): "/\\evil.com" passed two prefix checks
 * and the URL parser folds the backslash, so it resolved off-site. Parsing
 * it the way the browser will is the only check that agrees with the
 * browser. The login next-stash, chat links (#2817) and the tray all ask.
 */
export function sameOriginPath(
	path: string | null | undefined,
	// The tests run under node, where there is no location; any origin
	// serves, since the check is "did the parser keep it on that origin".
	origin = typeof location === 'undefined'
		? 'http://wattroom.invalid'
		: location.origin,
): path is string {
	if (!path || !path.startsWith('/')) return false;
	try {
		const url = new URL(path, origin);
		return url.origin === origin && url.href.startsWith(origin + '/');
	} catch {
		return false;
	}
}
