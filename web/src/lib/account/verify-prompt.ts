/**
 * Whether the address gate stands in front of the app (#781, ADR-0029).
 *
 * The address is the account's recovery attribute, so a rider onboarded with
 * the requirement confirms one before riding; an account that predates it is
 * asked, and asked again next session. Servers that cannot send mail show none
 * of this — the flow would have no way to finish (capability gating).
 */
import type { Me } from '$lib/account.svelte';

const SKIP_KEY = 'wattroom.verify-email.skipped';

export function shouldPromptEmail(me: Me | null, skipped: boolean): boolean {
	if (!me?.mailAvailable || me.emailVerified) return false;
	return me.emailRequired === true || !skipped;
}

/** Required accounts have no Later; the rest get one that lasts a session. */
export function canSkipEmailPrompt(me: Me | null): boolean {
	return me?.emailRequired !== true;
}

// sessionStorage, not localStorage: "not now" should mean this sitting, not
// forever. Both accessors can throw outright in a locked-down browser.
export function readSkipped(): boolean {
	try {
		return sessionStorage.getItem(SKIP_KEY) === '1';
	} catch {
		return false;
	}
}

export function markSkipped(): void {
	try {
		sessionStorage.setItem(SKIP_KEY, '1');
	} catch {
		// Private mode: the prompt simply comes back, which is the safe way to fail.
	}
}
