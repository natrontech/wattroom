import {
	createPersonalGuards,
	DEFAULTS,
	type GuardPhase,
	type GuardSample,
} from '$lib/workout/guards';
import { targetAt } from '$lib/workout/engine';
import type { RideDeps } from '$lib/session/ride-deps';

/**
 * What the session asks of this rider's trainer, and the say the rider has
 * over it: the bias trim and the guards. Both are personal — the shared
 * timeline is untouched by either.
 *
 * Called during component init, like createRide: the $derived inside need
 * the component's effect context.
 */
export function createRideTarget(
	deps: Pick<
		RideDeps,
		'live' | 'profile' | 'myId' | 'shared' | 'segments' | 'joined' | 'free'
	>,
	actuating: () => boolean,
) {
	// Bias is personal: ±% on my own targets, the shared timeline untouched.
	let bias = $state(1);
	/**
	 * The trim this screen is actually applying (#2075).
	 *
	 * A screen that writes no control point trims nothing, so a bias here
	 * would move the number a rider reads and the resistance under their legs
	 * not at all — and would score the ride against a plan nobody rode. Held
	 * at 1 in all three places at once, deliberately: the target this screen
	 * renders, the prescribed watts its guards judge, and the `bias` its
	 * samples carry. Divergence between those is what the client's meter and
	 * the hub's score exist not to have.
	 *
	 * The rider's own setting is kept rather than reset, so it returns with
	 * the grant instead of having to be dialled in again.
	 */
	const effectiveBias = $derived(actuating() ? bias : 1);
	function nudgeBias(step: number) {
		// The control is disabled where it is drawn (ux.md); this is the same
		// answer for anything that reaches past it.
		if (!actuating()) return;
		bias = Math.min(
			DEFAULTS.biasMax,
			Math.max(DEFAULTS.biasMin, Math.round((bias + step) * 100) / 100),
		);
	}

	/**
	 * What the session asks of this rider, before their own guards get a say —
	 * and whether the block asking is the workout's own sprint.
	 *
	 * The sprint flag is not decoration: `targetAt` returns no target for a
	 * sprint block, `?? 0` folds that into zero, and zero in ERG is a
	 * freewheel — the rider pedalled against nothing for the whole block
	 * (#2014). That is the session's half of #1529, which fixed the solo ride
	 * on the assumption the session was already right. It was not: a session
	 * flips to slope only for a sprint the SERVER armed, and nothing arms
	 * one from the timeline.
	 */
	const block = $derived.by((): { watts: number; sprint: boolean } => {
		if (!deps.joined())
			return {
				watts:
					deps.free.armed && deps.free.mode === 'watts' ? deps.free.watts : 0,
				sprint: false,
			};
		const game = deps.live.tick?.game;
		const mine = game?.riders?.[deps.myId() ?? ''];
		if (game?.phase === 'running' && mine && mine.targetPct) {
			return {
				watts: Math.round(mine.targetPct * deps.profile.current.ftp),
				sprint: false,
			};
		}
		const shared = deps.shared();
		const segments = deps.segments();
		if (!shared || shared.phase !== 'running' || segments.length === 0)
			return { watts: 0, sprint: false };
		const info = targetAt(segments, deps.profile.current.ftp, shared.elapsed);
		if (!info.done && info.segment?.kind === 'sprint')
			return { watts: 0, sprint: true };
		return {
			watts: Math.round((info.targetWatts ?? 0) * effectiveBias),
			sprint: false,
		};
	});
	const prescribed = $derived(block.watts);

	/**
	 * Auto-pause and the spiral release, the same machine the solo ride runs
	 * (#788). A rider who stops, or who grinds to a halt at 40 rpm, gets their
	 * target released in a session exactly as they would alone — and the
	 * session's clock does not notice, because the guards mask this rider's
	 * target and touch nothing shared.
	 */
	const guards = createPersonalGuards();
	let guardsReleased = $state(false);
	let guardPhase = $state<GuardPhase>('running');
	let guardResumeIn = $state(0);
	// The spiral release (docs/SPEC.md) fires in a session exactly as it does
	// solo; solo had a banner and a cue for it and the session had nothing —
	// the resistance vanished for ten seconds unexplained (audit 2026-09-09).
	let spiralActive = $state(false);
	function syncGuards() {
		guardsReleased = guards.released;
		guardPhase = guards.phase;
		guardResumeIn = guards.resumeIn;
		spiralActive = guards.spiralActive;
	}

	const target = $derived(guardsReleased ? 0 : prescribed);

	return {
		/** What the trim is doing, not what the rider once set it to (#2075). */
		get bias() {
			return effectiveBias;
		},
		/** The session's ask before the guards: zero when nothing is asked. */
		get prescribed() {
			return prescribed;
		},
		get target() {
			return target;
		},
		/** The block asking is the workout's own sprint (#2014). */
		get sprint() {
			return block.sprint;
		},
		get guard() {
			return guardPhase;
		},
		get resumeIn() {
			return guardResumeIn;
		},
		get spiralActive() {
			return spiralActive;
		},
		/** False while a guard has the trainer off the target. */
		get scoring() {
			return guards.scoring;
		},
		nudgeBias,
		/**
		 * One reading, counted once per wall-clock second (#1798). Only while
		 * a session is actually asking something of this rider. With no target
		 * there is nothing to release, and a rider resting in a voice channel
		 * between sessions is not "paused" — they are just there. Against the
		 * PRESCRIBED target, too: the one the trainer holds is zero exactly
		 * when a guard is already up.
		 */
		sample(metrics: GuardSample, counted: boolean) {
			if (prescribed > 0) guards.sample(metrics, prescribed, counted ? 1 : 0);
			else guards.reset();
			syncGuards();
		},
		/** The guards' countdowns, on the rider's own second. */
		tick() {
			guards.tick();
			syncGuards();
		},
	};
}
