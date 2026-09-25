/** What each sign-in provider is called, wherever one is named to a rider. */
export const providerName: Record<string, string> = {
	google: 'Google',
	github: 'GitHub',
	strava: 'Strava',
	dev: 'Dev sign-in',
};

export const nameOf = (id: string): string => providerName[id] ?? id;

/** What the sign-in page's provider row says (#2844). */
export type ProviderRow = 'providers' | 'unreachable' | 'unconfigured' | null;

/**
 * Which answer the provider row gives. `elsewhere` is the desktop shell, and
 * the browser's back-to-the-app screen after a hand-off: neither offers a
 * provider on the page, so "none configured" there was a false alarm about
 * a server that had them — told to every desktop rider on first launch.
 */
export function providerRow(
	a: { loaded: boolean; providers: string[]; unreachable: boolean },
	elsewhere: boolean,
): ProviderRow {
	if (!a.loaded || elsewhere) return null;
	if (a.providers.length > 0) return 'providers';
	return a.unreachable ? 'unreachable' : 'unconfigured';
}

/** The ways in the browser offers, for the shell's sign-in line (#2844): a
 *  passkey, then whatever this server has — never a fixed list. */
export const signInWays = (providers: string[]): string =>
	new Intl.ListFormat('en-GB', { type: 'disjunction' }).format([
		'Your passkey',
		...providers.map(nameOf),
	]);
