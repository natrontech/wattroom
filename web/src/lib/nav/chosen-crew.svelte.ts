import { readChosenCrew, rememberChosenCrew } from './crews';

/**
 * Which crew the sidebar is in (ADR-0020 amended, #1147), shared so a page
 * can put the column into its crew: opening a crew's page used to leave the
 * header naming another crew, with no row lit for where you were (audit
 * 2026-09-09). Remembered per device, as before.
 */
let id = $state<string | null>(readChosenCrew());

export const chosenCrew = {
	get id() {
		return id;
	},
	set(next: string) {
		if (id === next) return;
		id = next;
		rememberChosenCrew(next);
	},
};
