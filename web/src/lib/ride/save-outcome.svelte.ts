import type { RideBatzen } from '#lib/ride/batzen.ts';
import type { SaveAnswers } from '#lib/ride/ride-alone-save.ts';

/**
 * What the ride alone's save has answered so far, for the summary to draw:
 * in flight, its status, a retry, and the ride on the account once it is.
 */
export function createSaveOutcome() {
	let saving = $state(false);
	// The save's outcome is persistent status (errors.md); an export or a flag
	// failing must not overwrite it (audit 2026-09-09).
	let status = $state<string | null>(null);
	// The same upload again, while a save failed and could still go through
	// (#2618): the endpoint is idempotent, and the payload is still here.
	let retry = $state<(() => void) | null>(null);
	// The ride on the account, once it is: the summary's way forward (#1331).
	let id = $state<string | null>(null);
	let xp = $state<number | undefined>(undefined);
	let batzen = $state<RideBatzen | undefined>(undefined);
	return {
		get saving() {
			return saving;
		},
		get status() {
			return status;
		},
		get retry() {
			return retry;
		},
		get id() {
			return id;
		},
		get xp() {
			return xp;
		},
		/** What the ride put in the wallet (#4515), once saved. */
		get batzen() {
			return batzen;
		},
		/** A new ride: nothing answered yet. */
		reset() {
			saving = false;
			status = null;
			retry = null;
			id = null;
			xp = undefined;
			batzen = undefined;
		},
		/** Where one save's answers land: here while `current` holds. */
		answers(current: () => boolean, seen: () => boolean): SaveAnswers {
			return {
				current,
				seen,
				saving: (on) => {
					saving = on;
					if (on) retry = null;
				},
				status: (text, again) => {
					status = text;
					retry = again;
				},
				saved: (savedId, savedXp, savedBatzen) => {
					id = savedId;
					xp = savedXp;
					batzen = savedBatzen;
				},
			};
		},
	};
}
