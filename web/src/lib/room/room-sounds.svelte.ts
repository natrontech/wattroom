import type { SprintState } from '$lib/protocol';
import { serverNow } from '$lib/room/server-clock';
import { changes } from '$lib/sound/changes';
import { play, playCountdownTick } from '$lib/sound/cues';
import type { GuardPhase } from '$lib/workout/guards';

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
	/** The armed sprint, from the tick — null or undefined when none. */
	sprint: () => SprintState | null | undefined;
	/** Your own ride guard: auto-pause and the resume countdown. */
	guard: () => GuardPhase | undefined;
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

	// The sprint announces itself from here (#1412): the klaxon, the gun and
	// the fanfare lived in the overlay only the Training place draws, so a
	// rider on Chat or Members when the coach armed one heard nothing for all
	// fifteen seconds — the one moment WATTROOM.md lets the app go loud.
	// Timed on the server's clock, like the overlay and the ERG flip.
	let sprintNow = $state(serverNow());
	$effect(() => {
		if (!deps.sprint()) return;
		const id = setInterval(() => (sprintNow = serverNow()), 100);
		return () => clearInterval(id);
	});
	let heardSprint: {
		startsAtMs: number;
		stage: string;
		second: number;
	} | null = null;
	$effect(() => {
		const sprint = deps.sprint();
		if (!sprint) {
			heardSprint = null;
			return;
		}
		const now = sprintNow;
		if (!heardSprint || heardSprint.startsAtMs !== sprint.startsAtMs) {
			heardSprint = {
				startsAtMs: sprint.startsAtMs,
				stage: 'klaxon',
				second: -1,
			};
			play('klaxon');
		}
		const heard = heardSprint;
		if (now < sprint.startsAtMs) {
			const left = Math.ceil((sprint.startsAtMs - now) / 1000);
			if (left > 0 && left <= 2 && left !== heard.second) {
				heard.second = left;
				playCountdownTick(left);
			}
		} else if (now < sprint.endsAtMs) {
			if (heard.stage === 'klaxon') {
				heard.stage = 'live';
				play('go');
			}
		} else if (heard.stage === 'live') {
			heard.stage = 'podium';
			play('fanfare');
		}
	});

	// Your own guard (#1412): auto-pause is the state change the rider cannot
	// see coming — it fires when they have stopped looking — and the resume
	// countdown exists so picking up is not a jump-scare (docs/SPEC.md).
	const heardGuard = changes<GuardPhase | undefined>((next, previous) => {
		if (next === 'autopaused') play('block', -5);
		else if (next === 'resuming') playCountdownTick(3);
		else if (next === 'running' && previous === 'resuming') play('go');
	});
	$effect(() => heardGuard(deps.guard()));
}
