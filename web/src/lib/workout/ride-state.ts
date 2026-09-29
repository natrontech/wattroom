import type { SensorKind, SensorReading } from '$lib/ble/sensor';
import type { Trainer } from '$lib/ble/trainer';
import type { SprintSetup } from '$lib/ride/actuation';
import type { RecordedSecond } from './ride-record.svelte';
import type { Workout } from './types';

export type RideState =
	'idle' | 'countdown' | 'running' | 'autopaused' | 'resuming' | 'done';

/**
 * The count-in before the clock starts (#1800, docs/SPEC.md's session
 * lifecycle). A rider taps Start on the laptop beside the bike and needs a
 * moment to get back on it — a group session has always given them one,
 * and ADR-0046's parity rule makes it the surface's, not the group's.
 * Shorter than a group session's ten seconds because nobody else is being
 * waited for; the same three seconds SPEC gives the resume countdown, and
 * the same 3-2-1 cues.
 */
export const COUNTDOWN_SECONDS = 3;

/** Past this without a sample the dashboard, and the HUD, say so (#37). */
export const SIGNAL_LOST_MS = 3000;

/**
 * Whether the trainer has gone quiet — the rule both riding pages draw their
 * dropout banner from (#2158).
 *
 * It counts from the moment the CLOCK started, not from the first sample
 * (#1799). A trainer that streams frames with no power field never delivers
 * one, so a rule of the shape `sample && now - sample.at > …` is never true
 * for the rider it matters most to: /ramp ran its whole length that way, with
 * no banner, no fault cue, and its own stale guard holding the test open.
 *
 * `ridingSince` is stamped when the clock starts and not when Start was
 * pressed (#1800): the count-in is not a gap in the trainer's reporting, and
 * stamping it there put the banner up on the first tick.
 */
export function signalLost(
	session:
		| { state: RideState; sample: { at: number } | null | undefined }
		| null
		| undefined,
	// `undefined` is "the clock has not started", not 0: an injected clock
	// starts at 0 in a test, and a real timestamp of 0 must not read as no
	// timestamp at all (#2200).
	ridingSince: number | undefined,
	now: number,
): boolean {
	if (!session || ridingSince === undefined) return false;
	if (session.state === 'countdown' || session.state === 'done') return false;
	return now - (session.sample?.at ?? ridingSince) > SIGNAL_LOST_MS;
}

/** What createRideSession is built from. */
export interface RideOptions {
	trainer: Trainer;
	workout: Workout;
	ftp: number;
	/** Injected so tests can drive the clock; defaults to wall time. */
	now?: () => number;
	/**
	 * When the ride began, ms epoch — the crash-safety buffer's own stamp
	 * (#19), so the upload and a later retry from the recovery card name the
	 * same ride. Two stamps a few hundred ms apart used to save it twice
	 * (audit 2026-09-09). Defaults to now.
	 */
	startedAt?: number;
	/**
	 * Latest reading from each paired sensor (#11). Read per sample rather than
	 * subscribed to, because arbitration is a snapshot question — which source wins
	 * *right now* — and a sensor that has gone quiet has to lose on staleness.
	 */
	readings?: () => Partial<Record<SensorKind, SensorReading>>;
	/**
	 * The rider's sprint setup (#30/#41), read per sprint so a change on
	 * /settings lands mid-ride. A `sprint` step carries no ERG target by
	 * design — the trainer is released to slope for the window — and this path
	 * used to collapse that into ERG 0 W, which is a freewheel (#1529).
	 */
	sprint?: () => SprintSetup;
	/** Called with each recorded sample — the crash-safety buffer's seam (#19). */
	onRecord?: (sample: RecordedSecond) => void;
}
