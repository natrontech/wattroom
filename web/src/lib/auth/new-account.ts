/**
 * Latches the "this sign-in created an account" flag (#784).
 *
 * The callback lands on `/?new=<provider>` and the layout routes onward within
 * a tick, dropping the query with it — so the value has to be caught before
 * that and handed to whoever renders the notice. Same shape as the deep-link
 * stash next to it.
 */
let seen: string | null = null;

/** Call once at app start, before any routing. */
export function noteNewAccount(search = ''): void {
	if (seen !== null) return;
	const provider = new URLSearchParams(search).get('new');
	if (provider) seen = provider;
}

/** Returns the provider once; the notice is a one-time thing. */
export function takeNewAccount(): string | null {
	const provider = seen;
	seen = null;
	return provider;
}
