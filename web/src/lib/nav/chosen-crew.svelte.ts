import { account } from '$lib/account.svelte';
import { readChosenCrew, rememberChosenCrew } from './crews';

/**
 * Which crew the sidebar is in (ADR-0020 amended, #1147), shared so a page
 * can put the column into its crew: opening a crew's page used to leave the
 * header naming another crew, with no row lit for where you were (audit
 * 2026-09-09). A pick lasts the session; a fresh load opens in the main crew
 * the account names (#2144), and only an account that names none falls back
 * to what this device remembers — a new device used to get whichever crew
 * the server listed first.
 */
let picked = $state<string | null>(null);
const remembered = readChosenCrew();

export const chosenCrew = {
	get id() {
		return picked ?? account.me?.homeCrewId ?? remembered;
	},
	set(next: string) {
		if (picked === next) return;
		picked = next;
		rememberChosenCrew(next);
	},
};
