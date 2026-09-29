import { pairError } from '$lib/ble/pair-error';
import { arbitrate } from '$lib/ble/arbitrate';
import { createFlightRecorder } from '$lib/ride/flightrecorder.svelte';
import { createActuator } from '$lib/ride/actuation.svelte';
import {
	biasPress,
	EASIER_HARDER_OFF,
	ergPress,
} from '$lib/ride/easier-harder';
import { play } from '$lib/sound/cues';
import { gearsEnabled } from '$lib/ride/gears-enabled';
import type { Trainer, TrainerStatus } from '$lib/ble/trainer';
import { sensors } from '$lib/sensors.svelte';
import { wireMetrics } from '$lib/session/wire';
import { SIGNAL_LOST_MS } from '$lib/workout/ride-state';
import type { RideDeps } from '$lib/session/ride-deps';
import { createRideTarget } from '$lib/session/ride-target.svelte';
import { createSessionSprint } from '$lib/session/ride-sprint.svelte';
import type { RideEffort } from '$lib/roadside';
import {
	mayActuate,
	quietFault,
	type TrainerFault,
} from '$lib/session/sensor-status';

/**
 * Riding along: the trainer, the target it holds, the trim on it, and the
 * sprint that lets go of it. Lifted out of ChannelShell so the shell composes
 * rather than owns (code-quality.md's ceiling); behaviour unchanged.
 *
 * Called during component init — the $derived and $effect inside need the
 * component's effect context.
 */
export function createRide(deps: RideDeps) {
	let trainer = $state<Trainer | null>(null);
	let error = $state<string | null>(null);
	let hrSource = $state<'heart-rate' | 'trainer' | null>(null);
	let status = $state<TrainerStatus>('disconnected');
	let lastSampleAt = $state(0);
	/** The latest arbitrated reading, for the one screen that asks (#1799). */
	let latest = $state<{ watts: number; cadence: number } | null>(null);
	// The wall-clock second the guards last counted (#1798): they count
	// seconds, and a trainer notifies more than once a second.
	let guardSecond = -1;
	let pairing = $state(false);
	let unsubscribe: (() => void)[] = [];
	const recorder = createFlightRecorder();

	/**
	 * What the trainer is actually doing (#520). "Paired" used to be the only
	 * state a group ride could show, so a trainer that dropped, reattached in
	 * a loop, or that delivered not one watt all read as working.
	 *
	 * Silence is judged against the wall clock; the tick is read purely to
	 * re-run this once a second, since a sample that never arrives cannot
	 * invalidate anything by itself.
	 */
	// The local second the guards' countdowns run on; the silence check reads
	// it too (#1852) — off the server tick, losing the socket froze the check.
	let now = $state(Date.now());
	const fault = $derived.by((): TrainerFault => {
		if (!trainer) return null;
		if (status !== 'connected') return 'reconnecting';
		void now;
		// Counted from the connect, not the first sample: a trainer that never
		// sends one is the reported failure, and exempting it would hide it.
		// docs/SPEC.md's one number (#2161): this is the rider's OWN trainer,
		// the same question /ride and /ramp ask, and a group ride used to wait
		// ten seconds where they waited three.
		return Date.now() - lastSampleAt > SIGNAL_LOST_MS
			? quietFault(trainer)
			: null;
	});

	/**
	 * Whether this screen is the one driving the trainer (#1853). Derived, not
	 * read at the moment of writing, so a grant regained after a reconnect
	 * re-runs the actuation effect on the spot: ERG holds the last value
	 * written, so the trainer is sitting on a target as stale as the gap was
	 * long, and waiting for the next natural change would leave it there for
	 * the rest of the block.
	 */
	const actuating = $derived(mayActuate(deps.live.pairing));

	const aim = createRideTarget(deps, () => actuating);
	const sprint = createSessionSprint(deps);
	// The grant came back and the gear restarted at k = 1 (#3330): said with
	// a cue the way it moved, and on the gear field for a few seconds.
	let gearResetAt = $state(0);
	const actuator = createActuator(
		() => trainer,
		(was) => {
			// A gear never shifted is already the real one: nothing to say.
			if (was === 1) return;
			gearResetAt = Date.now();
			play(was < 1 ? 'shift-up' : 'shift-down');
		},
	);
	/** Why Easier / Harder cannot act here, or null when it can (#3329, #3330). */
	const shiftOff = $derived.by(() => {
		if (!gearsEnabled()) return EASIER_HARDER_OFF.gated;
		if (!trainer) return EASIER_HARDER_OFF.noTrainer;
		if (!actuating) return EASIER_HARDER_OFF.lost;
		return deps.joined() || deps.free.armed ? null : EASIER_HARDER_OFF.idle;
	});

	// The guards' countdowns run on a local second — the session's clock is
	// everyone's, and a rider's own recovery must not wait on it.
	$effect(() => {
		if (!trainer) return;
		const id = setInterval(() => {
			now = Date.now();
			aim.tick();
		}, 1000);
		return () => clearInterval(id);
	});

	/** Slope, whoever asked for it: the coach's armed sprint or the workout's. */
	const sprinting = $derived(deps.joined() && (sprint.armedLive || aim.sprint));
	$effect(() => {
		if (!trainer) return;
		// Another of this rider's screens holds the trainer claim (#1853), so
		// this one keeps its link, its samples and its Forget and writes
		// nothing: two tabs actuating fight at 1 Hz as soon as their bias
		// differs. A grant that comes back starts afresh (the actuator's).
		if (!actuator.grant(actuating)) return;
		// A sprint outranks the guards, deliberately. Auto-pause is an
		// INFERENCE that the rider left; the klaxon is an announced event they
		// are about to answer, and a rider who was sitting at zero when it
		// sounded would otherwise never be given the hill. (Tried the other
		// way round first; the two-rider e2e is what showed the cost.)
		if (sprinting) {
			const { sprintGrade, singleSpeed, ftp } = deps.profile.current;
			actuator.sprint({ grade: sprintGrade, singleSpeed }, ftp);
			return;
		}
		// A free ride on a grade is a slope the rider chose, not a target
		// to hold — and nothing for the guards to release (docs/SPEC.md).
		if (!deps.joined() && deps.free.armed && deps.free.mode === 'grade') {
			actuator.grade(deps.free.grade);
			return;
		}
		actuator.hold(aim.target);
	});

	async function ride(next: Trainer) {
		if (pairing) return;
		// Release before attach (#1716): pairing over a live trainer used to
		// leave the first one connected and reattaching, so the hardware had
		// two GATT clients both asking for control.
		if (trainer) unpair();
		error = null;
		lastSampleAt = 0;
		latest = null;
		guardSecond = -1;
		pairing = true;
		unsubscribe.push(
			next.onStatus((s) => {
				const back = s === 'connected' && status !== 'connected';
				status = s;
				// The link came back (#1846): the driver re-requested control,
				// but nothing the ride wanted had changed, so the actuation
				// effect had nothing to say — and the trainer held no target for
				// the rest of the block. Say it again, recomputed.
				if (back && trainer === next && actuating) actuator.reissue();
			}),
		);
		try {
			// A trainer handed over live (#1851) is not connected again: on the
			// FTMS driver that would tear its listeners down and re-request
			// control mid-ride for nothing.
			if (next.status !== 'connected') await next.connect();
			status = next.status;
			// t0 for the silence check above; the first frame should be ~1 s away.
			lastSampleAt = Date.now();
			unsubscribe.push(
				next.onSample((sample) => {
					lastSampleAt = sample.at;
					actuator.sample(sample);
					const metrics = arbitrate(
						{ trainer: sample, sensors: sensors.readings },
						sample.at,
					);
					latest = { watts: metrics.watts, cadence: metrics.cadence };
					const second = Math.floor(sample.at / 1000);
					const counted = second > guardSecond;
					if (counted) guardSecond = second;
					aim.sample(metrics, counted);
					// The ⚑'s ring (#2657): this ride's own numbers from pairing
					// on — the target the trainer was given and why — not the
					// hub's echo, and not only while a session's clock runs.
					if (counted)
						recorder.tick({
							watts: metrics.watts,
							cadence: metrics.cadence,
							target: aim.target,
							state: sprinting
								? 'sprint'
								: aim.prescribed === 0
									? 'no target'
									: aim.spiralActive
										? 'spiral'
										: aim.guard,
						});
					hrSource =
						metrics.from.heartRate === 'heart-rate' ||
						metrics.from.heartRate === 'trainer'
							? metrics.from.heartRate
							: null;
					deps.live.sendMetrics(
						wireMetrics(
							metrics,
							deps.profile.current.shareHr,
							aim.bias,
							!aim.scoring,
						),
					);
					const shared = deps.shared();
					if (shared?.phase === 'running' && deps.joined())
						deps.recording.record(shared.elapsed, metrics.watts);
					else if (counted && !deps.joined())
						deps.free.second({
							watts: metrics.watts,
							cadence: metrics.cadence,
							hr: metrics.heartRate ?? 0,
						});
				}),
			);
			trainer = next;
		} catch (cause) {
			error = pairError(cause);
			for (const off of unsubscribe) off();
			unsubscribe = [];
		} finally {
			pairing = false;
		}
	}
	/** Re-pairing is one button (rider report): drop the trainer and release
	 *  its subscription, keeping the ride buffer open so a fresh pair
	 *  continues the same session. */
	function unpair() {
		const held = trainer;
		// Read before letting go: zeroing is an actuation like any other
		// (#1853), and a screen that is not driving must not release a target
		// the screen that IS driving holds.
		const zero = actuating;
		letGo();
		if (zero) void held?.setTargetPower(0);
		void held?.disconnect();
	}
	/**
	 * Give the trainer to a solo ride (#2635), still connected — the solo
	 * slot's handOff, from the channel's side. /ride used to drop the link a
	 * voice channel held and ask the rider to pair the same unit again.
	 * Null when nothing is held.
	 */
	function handOff(): Trainer | null {
		const held = trainer;
		letGo();
		return held;
	}
	function letGo() {
		for (const off of unsubscribe) off();
		unsubscribe = [];
		trainer = null;
		error = null;
		status = 'disconnected';
		lastSampleAt = 0;
		latest = null;
		// Nothing is sent without a trainer, so "shared" would be a lie (#2804).
		hrSource = null;
	}
	function stop() {
		deps.live.finish();
		unpair();
	}

	return {
		get trainer() {
			return trainer;
		},
		/** What a session's ⚑ sends: lives as long as the ride, not the page. */
		recorder,
		get error() {
			return error;
		},
		/** The chooser is open (#1716) — one answer, not one per component. */
		get pairing() {
			return pairing;
		},
		get hrSource() {
			return hrSource;
		},
		/** null while it is behaving; the channel's places render the rest (#520). */
		get fault() {
			return fault;
		},
		/** "210 W · 88 rpm" while the trainer reports; Settings › Equipment's proof it works. */
		get reading(): string | undefined {
			if (!latest || fault === 'silent') return undefined;
			return `${Math.round(latest.watts)} W · ${Math.round(latest.cadence)} rpm`;
		},
		/** What the trim is doing, not what the rider once set it to (#2075). */
		get bias() {
			return aim.bias;
		},
		/**
		 * Does this screen write the trainer's control point? (#1853, #2075)
		 * What the places gate the bias trim on — a link existing is not the
		 * same question, and gating on that drew a control that changed
		 * nothing (ux.md).
		 */
		get actuating() {
			return actuating;
		},
		get target() {
			return aim.target;
		},
		/** The rider's own guard state — the session's clock is unaffected (#788). */
		get guard() {
			return aim.guard;
		},
		get guardResumeIn() {
			return aim.resumeIn;
		},
		/** The spiral-of-death release: targets off for a few seconds, on purpose. */
		get spiralActive() {
			return aim.spiralActive;
		},
		/**
		 * The workout's own sprint block as a window (#2014). The session draws
		 * and sounds it exactly as it does a coach's; the server's armed
		 * sprint outranks it, since that is the one being scored.
		 */
		get blockSprint() {
			return sprint.blockWindow;
		},
		/**
		 * What the ride asks of this rider, for a bottle from the roadside
		 * (#3022): the block's own watts, never the trainer's. The spiral
		 * release zeroes the trainer for ten seconds in the middle of an
		 * interval — the rider's hardest moment, and no easy block. A rider
		 * who has stopped is asked nothing. A sprint counts from its klaxon.
		 */
		get effort(): RideEffort {
			return {
				targetWatts: aim.guard === 'autopaused' ? 0 : aim.prescribed,
				ftp: deps.profile.current.ftp,
				sprinting: !!deps.live.tick?.sprint || !!sprint.blockWindow,
			};
		},
		nudgeBias: aim.nudgeBias,
		/** Easier / Harder (#3328): a gear in SIM; in ERG a session's bias, or the free ride's watts. */
		easierHarder(dir: 1 | -1) {
			const erg = deps.joined()
				? biasPress(() => aim.bias, aim.nudgeBias)
				: deps.free.armed && deps.free.mode === 'watts'
					? ergPress(() => deps.free.watts, deps.free.nudge)
					: undefined;
			return actuator.easierHarder(dir, erg);
		},
		/** Easier / Harder acts: this screen drives a trainer, in a session or a free ride (#3329). */
		get shifting() {
			return shiftOff === null;
		},
		get shiftOff() {
			return shiftOff;
		},
		atEnd: actuator.atEnd,
		/** The gear field's k, label and clamp (ADR-0084). */
		get gear() {
			return actuator.gear;
		},
		get gearResetAt() {
			return gearResetAt;
		},
		ride,
		unpair,
		handOff,
		stop,
	};
}
