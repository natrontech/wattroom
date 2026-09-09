import type { SprintState } from '$lib/protocol';
import { serverNow } from '$lib/room/server-clock';
import { changes } from '$lib/sound/changes';
import { play, playCountdownTick } from '$lib/sound/cues';
import type { GuardPhase } from '$lib/workout/guards';
import type { RideState } from '$lib/workout/session.svelte';

/**
 * What a ride says out loud to the rider on it: a block change, their own
 * guard (auto-pause, the resume countdown), the spiral release, a trainer
 * fault and its recovery, a sprint window, the end. These lived in the room's
 * createRoomSounds (#834, #1412) and reached nobody riding alone (#1792): a
 * solo rider was auto-paused, released, dropped and finished in silence, with
 * one block cue the page played by hand. ADR-0046's parity rule: a rider
 * alone hears what the same rider in a room hears. The room composes this
 * and adds what needs people — the shared countdown, the coach's pause, the
 * games.
 */
export interface RideSoundDeps {
	/**
	 * The fault worth hearing, already ranked by the caller in the order the
	 * banner ranks them. Null when nothing is wrong.
	 */
	fault: () => string | null;
	/** The sprint window — null or undefined when none. */
	sprint: () => SprintState | null | undefined;
	/** Your own ride guard: auto-pause and the resume countdown. */
	guard: () => GuardPhase | undefined;
	/** The spiral release: your targets off for a few seconds, on purpose. */
	spiral: () => boolean | undefined;
	/** The block you are in while the session runs; undefined otherwise. */
	block: () => number | undefined;
	/**
	 * The ride just ended by its own clock or the rider's button. The room
	 * says its end from the shared phase instead and leaves this out.
	 */
	ended?: () => boolean;
}

/** The guard phase a solo session's state stands for, for `guard` above. */
export function guardOfRide(
	state: RideState | undefined,
): GuardPhase | undefined {
	if (state === 'autopaused' || state === 'resuming' || state === 'running')
		return state;
	return undefined;
}

export function createRideSounds(deps: RideSoundDeps) {
	// A block change is the most frequent "your legs do something different"
	// there is. Only while the session runs: the index going to undefined at
	// the end is the end, not a block.
	const heardBlock = changes<number | null>((index, previous) => {
		if (index !== null && previous !== null) play('block');
	});
	$effect(() => heardBlock(deps.block() ?? null));

	// The spiral release (docs/SPEC.md): the target drops on purpose, and
	// comes back — said the way auto-pause is, since it feels the same.
	const heardSpiral = changes<boolean>((on) =>
		play(on ? 'block' : 'go', on ? -5 : 0),
	);
	$effect(() => heardSpiral(deps.spiral() ?? false));

	// A fault, and its recovery, announce themselves too. The banner is the
	// whole story only for someone reading the screen — which is nobody on a
	// bike.
	const heardFault = changes<string | null>((now) =>
		play(now ? 'fault' : 'recover'),
	);
	$effect(() => heardFault(deps.fault()));

	// Your own guard (#1412): auto-pause is the state change the rider cannot
	// see coming — it fires when they have stopped looking — and the resume
	// countdown exists so picking up is not a jump-scare (docs/SPEC.md).
	const heardGuard = changes<GuardPhase | undefined>((next, previous) => {
		if (next === 'autopaused') play('block', -5);
		else if (next === 'resuming') playCountdownTick(3);
		else if (next === 'running' && previous === 'resuming') play('go');
	});
	$effect(() => heardGuard(deps.guard()));

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

	// The end is the phase change nobody announced (audit 2026-09-09): the
	// instrument vanishes, and a rider mid-interval read that as a crash.
	const heardEnd = changes<boolean>((over) => {
		if (over) play('fanfare');
	});
	$effect(() => {
		if (deps.ended) heardEnd(deps.ended());
	});
}
