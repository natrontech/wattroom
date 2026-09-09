import type { GameState } from '$lib/protocol';
import { gameCues, golfMoment } from '$lib/room/game-cues';
import { serverNow } from '$lib/room/server-clock';
import { changes } from '$lib/sound/changes';
import { play, playCountdownTick } from '$lib/sound/cues';
import {
	createRideSounds,
	type RideSoundDeps,
} from '$lib/ride/ride-sounds.svelte';

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
export interface SoundDeps extends RideSoundDeps {
	/** The shared timeline's phase, and how much countdown is left. */
	phase: () => string | undefined;
	countdownRemaining: () => number | undefined;
	/** The running game, from the tick — null or undefined when none. */
	game: () => GameState | null | undefined;
	/** Your own rider id, for the cues a game addresses to you. */
	me: () => string | undefined;
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

	// The session ending is the phase change nobody announced (audit
	// 2026-09-09): the instrument vanishes, and a rider mid-interval read
	// that as a crash rather than the coach stopping it.
	const heardEnd = changes<string>((phase, previous) => {
		if (phase === 'done' && (previous === 'running' || previous === 'paused'))
			play('fanfare');
	});
	$effect(() => heardEnd(deps.phase() ?? 'idle'));

	// The rider's own cues — block, guard, spiral, fault, the sprint — are
	// the ride's, not the room's (#1792): a rider alone hears them too.
	createRideSounds(deps);

	// A game's cues from here, like the sprint's (#1412 for sprints, audit
	// 2026-09-09 for games): they lived in GamePanel, which only the Training
	// place draws, so Team Relay handing you the front, your last life
	// burning or Watt Golf's hole opening was silent on the Lounge.
	let seenGame: GameState | null = null;
	$effect(() => {
		const game = deps.game() ?? null;
		const before = seenGame;
		seenGame = game;
		if (!game) return;
		for (const cue of gameCues(before, game, deps.me()))
			play(cue.id, cue.shift);
	});
	// Watt Golf's run-in is a clock, not a state change: which second was
	// last spoken is all that is kept, so a re-render stays quiet.
	// Server time (#1588): Watt Golf's hole is a server timestamp, and the
	// rider is blind by design — a fast laptop counted the wrong second in.
	let gameNow = $state(serverNow());
	$effect(() => {
		if (!deps.game()) return;
		const id = setInterval(() => (gameNow = serverNow()), 500);
		return () => clearInterval(id);
	});
	let heardGolfSecond = -1;
	$effect(() => {
		const game = deps.game();
		const moment = game ? golfMoment(game, gameNow) : null;
		if (!moment) {
			heardGolfSecond = -1;
			return;
		}
		const second = 'go' in moment ? 0 : moment.tick;
		if (second === heardGolfSecond) return;
		heardGolfSecond = second;
		if ('go' in moment) play('go');
		else playCountdownTick(moment.tick);
	});
}
