import { signalLost } from './ride-state';

/**
 * Whether a solo ride's trainer has gone quiet — /ride and /ramp alike, which
 * each kept their own clock and `ridingSince` (#3359). A frozen number is
 * worse than a warning: past SIGNAL_LOST_MS without a sample the dashboard
 * says so, persistently, while the driver reconnects (#37).
 *
 * Counted from the start, not from the first sample (#1799, #2158): a trainer
 * that streams frames without a power field never delivers one, and the ride
 * ran its full length with nothing on screen. Stamped when the CLOCK starts,
 * not when Start was pressed (#1800) — the count-in is not a gap in the
 * trainer's reporting.
 */
export function createSignalWatch(
	session: () => Parameters<typeof signalLost>[0],
) {
	let now = $state(Date.now());
	let ridingSince: number | undefined = $state();
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	$effect(() => {
		const s = session();
		if (s?.state === 'running' && ridingSince === undefined)
			ridingSince = Date.now();
		if (!s) ridingSince = undefined;
	});
	return {
		get lost() {
			return signalLost(session(), ridingSince, now);
		},
	};
}
