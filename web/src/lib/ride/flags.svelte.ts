import { createFlightRecorder } from '$lib/ride/flightrecorder.svelte';

/**
 * The ⚑ for one riding page (#52, ADR-0006): a flight recorder, the flags
 * pressed during the ride, and sending them afterwards. Lived inline on
 * /ride; /ramp had no ⚑ at all (#1799), so a ramp that went wrong could not
 * be reported with the one mechanism built for exactly that.
 */
export function createRideFlags(route: string) {
	const recorder = createFlightRecorder();
	let sent = $state(0);
	let sending = $state(false);
	let error = $state<string | null>(null);
	let trainer = 'simulated';
	return {
		recorder,
		/** Flags pressed and not yet sent — the ones the rider annotates. */
		get unsent() {
			return recorder.flags.slice(sent);
		},
		get sent() {
			return sent;
		},
		get sending() {
			return sending;
		},
		get error() {
			return error;
		},
		/** The ride is starting on this trainer: the recorder's first event. */
		riding(trainerName: string, what: string) {
			trainer = trainerName;
			recorder.event('ride', what);
		},
		/** Send what is unsent, in order, stopping at the first refusal. */
		async send() {
			sending = true;
			error = null;
			for (const flag of recorder.flags.slice(sent)) {
				const res = await recorder.submit(flag, { route, trainer });
				if (res.ok) sent++;
				else {
					error = res.error.message;
					break;
				}
			}
			sending = false;
		},
		/**
		 * The page is going (#2619): what the rider flagged goes now, notes
		 * and all. The tap was the consent — the copy promised it after the
		 * ride — and leaving without pressing Send dropped it. Nothing is left
		 * to show the answer, and a Send already under way finishes on its own.
		 *
		 * `closing` is a tab on its way out, which only a keepalive request
		 * survives. ponytail: keepalive shares 64 KB across every request in
		 * flight and a flag can be most of that, so a closed tab with several
		 * flags may drop some; an in-app leave sends plainly and has no cap.
		 */
		flush(closing = false) {
			if (sending) return;
			for (const flag of recorder.flags.slice(sent))
				void recorder.submit(flag, { route, trainer }, closing);
			sent = recorder.flags.length;
		},
	};
}
