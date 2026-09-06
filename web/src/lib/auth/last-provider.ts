/**
 * Which way in this browser used last (#784).
 *
 * The cheap half of the duplicate-account problem: a rider who signed in with
 * Strava in August and clicks "Continue with GitHub" in September lands in a
 * fresh, empty account. Linking is fixed, but only for a rider who knows to
 * link — nothing else helps them recognise the account they already have.
 *
 * ponytail: recorded when the button is clicked, not when the sign-in
 * succeeds. The OAuth round trip is a full navigation, so "succeeded" is a
 * different page load; an abandoned attempt leaving the mark behind costs a
 * rider nothing, and the server would need a per-session column to do better.
 */
const KEY = 'wattroom.last-provider';

export function rememberProvider(id: string): void {
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// Private mode, or storage refused: the hint is a nicety, never a gate.
	}
}

export function lastProvider(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}
