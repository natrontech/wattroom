import {
	MaxRideSamples,
	type GameState,
	type SoloGameControl,
	type SoloGameFrame,
} from '#lib/protocol.ts';
import { riderLane } from '#lib/rider-lane.svelte.ts';
import { gameMode } from '#lib/session/modes.ts';
import type { Workout } from '#lib/workout/types.ts';

/**
 * A game alone (#4539): a game picked on the Ride card runs on that ride
 * alone. Before, the card's game door opened a session in the rider's crew,
 * which the crew saw and which ran from the first second. Now it starts like
 * a workout does, Start and the 3 s count-in, and the hub keeps the score on
 * the rider's own lane (hub/solo_game.go), with the same rules a session's
 * game plays. Nothing of it reaches a crew or another rider.
 */

/** The modes that make sense with nobody else there (docs/spec/game-modes.md). */
export const SOLO_GAMES = ['watt-golf', 'floor-is-lava', 'backyard-ramp'];

/**
 * What the ride alone rides under a game: no workout and no road, its own
 * time and no end, the drive the rider's (Road or Watts). Unscored: the game
 * keeps the score, and a workout's execution would measure nothing.
 */
export function gameWorkout(mode: string): Workout {
	return {
		name: gameMode(mode)?.label ?? 'Game',
		unscored: true,
		steps: [{ type: 'road', seconds: MaxRideSamples }],
	};
}

/** The lane's half the game uses: a seam for the tests. */
export interface GameLane {
	sendGame(control: SoloGameControl): void;
	onGame(hear: (frame: SoloGameFrame) => void): () => void;
}

export interface SoloGameDeps {
	mode: string;
	ftp: number;
	kg: number;
	/**
	 * This second's watts while the ride rides, or null while it does not:
	 * the count-in, which has not started the game yet, and the summary.
	 */
	watts: () => number | null;
	lane?: GameLane;
	/** Injected so tests can drive the seconds. */
	every?: (tick: () => void) => () => void;
	id?: string;
}

const eachSecond = (tick: () => void) => {
	const timer = setInterval(tick, 1000);
	return () => clearInterval(timer);
};

export function createSoloGame(deps: SoloGameDeps) {
	const lane = deps.lane ?? riderLane;
	const id = deps.id ?? crypto.randomUUID();
	let state = $state.raw<GameState | null>(null);
	// The hub no longer holds it: a restart, or a long dropout.
	let lost = $state(false);
	let over = false;

	const unhear = lane.onGame((frame) => {
		if (frame.id !== id || over) return;
		if (frame.gone) lost = !!state;
		else if (frame.state) state = frame.state;
	});

	// The first second after the count-in starts the game; every one after it
	// is a sample. A start the socket lost is sent again the next second, and
	// the hub takes a second start of the same id as the game already running.
	function second() {
		if (over || lost) return;
		const watts = deps.watts();
		if (watts === null) return;
		if (!state)
			lane.sendGame({
				action: 'start',
				id,
				mode: deps.mode,
				ftpWatts: deps.ftp,
				weightKg: deps.kg,
			});
		else lane.sendGame({ action: 'sample', id, watts: Math.round(watts) });
	}
	const stop = (deps.every ?? eachSecond)(second);

	return {
		mode: deps.mode,
		get state() {
			return state;
		},
		get lost() {
			return lost;
		},
		/**
		 * What the game asks the trainer to hold, in watts: Backyard Ramp's
		 * line, or the easy spin once out. The other two ask nothing of the
		 * trainer; the rider finds their watts on the drive they chose.
		 */
		get ask() {
			const mine = state?.phase === 'running' ? state.riders : undefined;
			const pct = mine ? Object.values(mine)[0]?.targetPct : undefined;
			return pct ? Math.round(pct * deps.ftp) : 0;
		},
		/** The game let go, with its ride or by the rider's End game. */
		end() {
			if (over) return;
			over = true;
			stop();
			unhear();
			if (!lost) lane.sendGame({ action: 'end', id });
		},
	};
}

export type SoloGame = ReturnType<typeof createSoloGame>;
