import { changes } from '$lib/sound/changes';
import { play, playCountdownTick } from '$lib/sound/cues';

/**
 * What the room says out loud (#834, #686). Riders are on a bike three metres
 * from the screen and are not watching it, so every state change that asks the
 * legs for something different announces itself.
 *
 * Lifted out of RoomShell (code-quality.md's ceiling); behaviour unchanged.
 * It is three effects reading four things, and it was the clearest seam in a
 * file where the sheet, the seat offering, the stage and the panel all meet.
 *
 * Ducking and the music-aware gate threshold are NOT here: they belong to the
 * room connection (#216), because they have to work on every page rather than
 * only the one holding this component.
 */
export interface SoundDeps {
	/** The shared timeline's phase, and how much countdown is left. */
	phase: () => string | undefined;
	countdownRemaining: () => number | undefined;
	/**
	 * The fault worth hearing, already ranked by the caller in the order the
	 * banner ranks them — so a trainer drop under a voice drop is heard once,
	 * as the thing that actually matters. Null when nothing is wrong.
	 */
	fault: () => string | null;
}

export function createRoomSounds(deps: SoundDeps) {
	// The last count spoken, so a tick is said once. -1 is "nothing yet",
	// which is also what makes `go` fire exactly once on the way out.
	let heardCount = -1;

	$effect(() => {
		if (deps.phase() !== 'countdown') {
			if (deps.phase() === 'running' && heardCount > 0) {
				heardCount = -1;
				play('go');
			}
			return;
		}
		const left = deps.countdownRemaining() ?? 0;
		if (left <= 3 && left > 0 && left !== heardCount) {
			heardCount = left;
			playCountdownTick(left);
		}
	});

	// Pause and resume are the one phase change that tells the legs to do
	// something different, and they were the silent one (#834). The block cue
	// is exactly right for it: the target just changed.
	const heardPause = changes<boolean>((paused) =>
		play('block', paused ? -5 : 0),
	);
	$effect(() => heardPause(deps.phase() === 'paused'));

	// A fault, and its recovery, announce themselves too. The banner is the
	// whole story only for someone reading the screen — which is nobody on a
	// bike.
	const heardFault = changes<string | null>((now) =>
		play(now ? 'fault' : 'recover'),
	);
	$effect(() => heardFault(deps.fault()));
}
