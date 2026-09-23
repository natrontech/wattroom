/**
 * How the docked player ARRIVES at a volume (#152). The cue bus glides a
 * WebAudio gain node and is exact; an iframe has no gain to glide, so the
 * dock steps `setVolume` toward the target instead — and those steps are the
 * only thing here.
 *
 * WHEN to move is not this module's business: the attack, the hold and the
 * release belong to the one duck (`$lib/sound/duck`), which hands every
 * consumer a target and a duration. This turns that duration into steps.
 */

/** The player's volume knob, as much of it as a ramp needs. */
export interface VolumeKnob {
	/** Where the player is now; undefined before it will say, so the ramp starts at the target. */
	read(): number | undefined;
	/** 0…100, integers — what the embed's API takes. */
	write(volume: number): void;
}

/**
 * One step per frame's worth of time: fine enough that a 150 ms attack is
 * heard as a dip rather than a staircase, coarse enough that a release is a
 * dozen calls across an iframe boundary and not four hundred.
 */
const STEP_MS = 30;

export interface MusicRamp {
	/** Move to `target` over `ms`. 0 ms lands there now — a fader move must not wait out a ramp. */
	to(target: number, ms: number): void;
	/** Stop mid-ramp, leaving the volume where it got to. The dock's teardown. */
	stop(): void;
}

export function createMusicRamp(knob: VolumeKnob): MusicRamp {
	let timer: ReturnType<typeof setInterval> | undefined;

	function stop(): void {
		clearInterval(timer);
		timer = undefined;
	}

	return {
		stop,
		to(target: number, ms: number): void {
			stop();
			if (ms <= 0) {
				knob.write(Math.round(target));
				return;
			}
			const from = knob.read() ?? target;
			const steps = Math.max(1, Math.round(ms / STEP_MS));
			let step = 0;
			timer = setInterval(() => {
				step += 1;
				knob.write(Math.round(from + ((target - from) * step) / steps));
				if (step >= steps) stop();
			}, STEP_MS);
		},
	};
}
