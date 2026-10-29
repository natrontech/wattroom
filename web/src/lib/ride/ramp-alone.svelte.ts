import { stampFtpAfter } from '$lib/ride/save';
import { RAMP, rampOver } from '$lib/workout/ramp';
import { SIGNAL_LOST_MS } from '$lib/workout/ride-state';
import type { createRideSession } from '$lib/workout/session.svelte';

type Session = ReturnType<typeof createRideSession>;

/**
 * The ramp test, held as the device's one ride (ADR-0093): the workout
 * session is `theRide`'s, and this is what makes it a test. It notices the
 * end, and it stamps the FTP the test produced onto the ride it became. Its
 * effects live in a root of their own, so the test runs on while the rider
 * reads the crew. `dispose` lets it go with the session.
 */
export function holdRampAlone(deps: {
	session: Session;
	/** The ride on the account, once the save answers. */
	savedId: () => string | null;
}) {
	const { session } = deps;
	let done = $state(false);
	// The number this test produced, once the rider accepts it (#1572). The
	// ride is saved the moment the test ends, carrying the FTP it was SCORED
	// against, and the rider accepts a new one seconds later, so the two
	// arrive in either order: the effect below waits for both.
	let producedFtp = $state<number | null>(null);
	let ftpMarkStatus = $state<string | null>(null);
	let ftpMarked = false;

	const dispose = $effect.root(() => {
		// The rider at the end of a ramp will not press a button; the test
		// notices for them. Against the PRESCRIBED target, not the actuator's:
		// stopping is how a ramp ends, and auto-pause releases the target to
		// zero three seconds before the five the test needs, so
		// `current.target` had the rider sitting in a pause that never resolved
		// into a result (#792).
		$effect(() => {
			if (done) return;
			const trailing = session.recording.slice(-RAMP.failSeconds).map((s) => ({
				watts: s.watts,
				target: session.info.targetWatts ?? 0,
			}));
			// The rows above are stamped with the target NOW: while no sample
			// lands they are a frozen record under a climbing target, which read
			// as a failure and ended a test on a Bluetooth glitch (#1794). The
			// tick still re-runs this every second, so the moment samples return
			// it looks again.
			const last = session.sample;
			const stale = !last || Date.now() - last.at > SIGNAL_LOST_MS;
			if (
				rampOver(session.state === 'done', session.elapsed, trailing, {
					stale,
					released: session.spiralActive,
				})
			) {
				session.stop();
				done = true;
			}
		});

		// The FTP the test produced, onto the ride the test became (#1572),
		// once, and only once both halves exist. `ftp_watts` on that row is the
		// number the ride was scored against, so the trend drew the ramp's
		// result a ride late; this is what puts the mark on the ramp itself.
		$effect(() => {
			const rideId = deps.savedId();
			const ftp = producedFtp;
			if (!rideId || !ftp || ftpMarked) return;
			ftpMarked = true;
			void stampFtpAfter(rideId, ftp).then((message) => {
				// The FTP is already on the account; only the chart mark is lost,
				// so this says exactly that rather than reading as a lost test.
				if (message)
					ftpMarkStatus = `${message} Your FTP is saved — the chart picks it up on your next ride.`;
			});
		});
	});

	return {
		/** The test is over: by its own end, or by I'm done. */
		get done() {
			return done;
		},
		get ftpMarkStatus() {
			return ftpMarkStatus;
		},
		/** I'm done, after its confirm (#2623). */
		stop() {
			if (done) return;
			session.stop();
			done = true;
		},
		/** The rider kept the number the test produced (#1572). */
		accept(ftp: number) {
			producedFtp = ftp;
		},
		dispose,
	};
}

export type RampAlone = ReturnType<typeof holdRampAlone>;
