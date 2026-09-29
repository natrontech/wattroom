import {
	createPersonalGuards,
	type GuardPhase,
	type GuardSample,
} from './guards';

/**
 * The personal guards (guards.ts) with their answers made reactive, for both
 * rides that read them: the solo session and the session ride's target
 * (#788). guards.ts stays a plain machine; every call that can move it syncs
 * the mirrors here, so neither caller keeps its own copy of that bookkeeping.
 */
export function createRiderGuards() {
	const guards = createPersonalGuards();
	let phase = $state<GuardPhase>('running');
	let released = $state(false);
	let resumeIn = $state(0);
	// The spiral release (docs/SPEC.md) fires in a session exactly as it does
	// solo; solo had a banner and a cue for it and the session had nothing —
	// the resistance vanished for ten seconds unexplained (audit 2026-09-09).
	let spiralActive = $state(false);
	// How long the rider has sat auto-paused, on the ride's own clock (#2622).
	let pausedSeconds = 0;

	function sync() {
		phase = guards.phase;
		released = guards.released;
		resumeIn = guards.resumeIn;
		spiralActive = guards.spiralActive;
		if (phase !== 'autopaused') pausedSeconds = 0;
	}

	return {
		get phase() {
			return phase;
		},
		get released() {
			return released;
		},
		get resumeIn() {
			return resumeIn;
		},
		get spiralActive() {
			return spiralActive;
		},
		/** Read when a sample is recorded or sent, as guards.ts answers it. */
		get scoring() {
			return guards.scoring;
		},
		pedalling(sample: GuardSample): boolean {
			return guards.pedalling(sample);
		},
		/** guards.ts's sample(); true when the trainer has to be told something new. */
		sample(sample: GuardSample, target: number, seconds = 1): boolean {
			const actuate = guards.sample(sample, target, seconds);
			sync();
			return actuate;
		},
		/** guards.ts's tick(); true when the trainer has to be told something new. */
		tick(seconds = 1): boolean {
			const actuate = guards.tick(seconds);
			sync();
			return actuate;
		},
		reset() {
			guards.reset();
			sync();
		},
		/** Another `seconds` auto-paused; how long the rider has sat stopped. */
		stoppedFor(seconds: number): number {
			pausedSeconds += seconds;
			return pausedSeconds;
		},
	};
}
