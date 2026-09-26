/**
 * The last way into an account cannot be taken away (#2879): the server
 * refuses it (refuseIfLastCredential), so the profile says so before the
 * click instead of asking "are you sure" and then being refused. `credentials`
 * counts providers and passkeys; absent, nothing is disabled and the
 * server's refusal still stands.
 */
export const LAST_WAY_IN =
	'This is the only way into your account. Add a passkey or connect another sign-in provider first.';

export function isLastWayIn(
	me: { credentials?: number } | null | undefined,
): boolean {
	return me?.credentials === 1;
}
