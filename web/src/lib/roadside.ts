/**
 * The roadside (#3022, ADR-0064): everyone in a voice channel who is not on a
 * given rider's bike — a phone propped beside it, a desk in the lounge, a
 * rider a game has put out. What the roadside may do is paint, sound and
 * information; never a rider's resistance, so nothing here reaches a trainer.
 *
 * The rules, pure. The deck is channel/RoadsideDeck.svelte, and holding a
 * bottle until the rider can take it is channel/bottles.svelte.ts.
 */
import type { LiveRider } from '$lib/channel/types';
import { zoneOf } from '$lib/components/zones';
import { BELL } from '$lib/icons';
import type { Arrival } from '$lib/messages/announce';
import type { Cheer, GameState } from '$lib/protocol';
import { followedRider } from '$lib/session/follow';
import type { CueId } from '$lib/sound/cue-catalogue';

/**
 * What one tick's cheers sound like. The bell is the roadside's one fixed
 * key and rings the cowbell — once a tick however many rang it, since a
 * cowbell pitched up by the crowd is no longer a cowbell. Every other cheer
 * keeps the blip, and a burst of them lands higher: the pitch is the crowd.
 */
export function cheerCues(
	batch: readonly Cheer[],
): { id: CueId; semitones: number }[] {
	const bells = batch.filter((cheer) => cheer.emoji === BELL).length;
	const others = batch.length - bells;
	const cues: { id: CueId; semitones: number }[] = [];
	if (bells > 0) cues.push({ id: 'cowbell', semitones: 0 });
	if (others > 0)
		cues.push({ id: 'cheer', semitones: Math.min((others - 1) * 2, 12) });
	return cues;
}

/**
 * A game has put this rider out and is still going (#3022): they are at the
 * roadside now, spinning easy with the deck in reach. Only the modes that
 * eliminate one rider at a time mark a rider out — Backyard Ramp and Floor is
 * Lava — so the rule needs no list of them.
 */
export function atRoadside(
	game: GameState | undefined,
	me: string | undefined,
): boolean {
	return (
		!!me && !!game && game.phase !== 'done' && !!game.riders?.[me]?.eliminated
	);
}

/** What the ride is asking of this rider right now. */
export interface Effort {
	/**
	 * The watts asked of the rider — the block's own or a game's, whichever is
	 * harder; 0 for none: paused, stopped, not riding.
	 */
	targetWatts: number;
	ftp: number;
	/** The zone a game calls for everyone (Floor is Lava); 0 when none is called. */
	calledZone: number;
	/** A sprint window is open or about to — the one moment nobody reaches down. */
	sprinting: boolean;
	/**
	 * A running game this screen cannot read an easy moment from: a Points
	 * Race keeps its sprint windows to itself, and a mode this client does not
	 * know yet says nothing at all. Never a valley until it ends.
	 */
	unreadable: boolean;
}

/**
 * The ride's half, from the rider's own session (session/ride.svelte.ts):
 * what the block prescribes — not what the trainer holds, which the spiral
 * release zeroes for ten seconds in the middle of an interval — and whether a
 * sprint is armed.
 */
export type RideEffort = Pick<Effort, 'targetWatts' | 'ftp' | 'sprinting'>;

/**
 * The effort from what a connection knows: the ride's, and the game's as the
 * server sends each mode (hub/mode_*.go). A rider a game has put out is
 * spinning easy whatever the rest of the field is asked.
 */
export function effortOf(
	ride: RideEffort,
	game: GameState | undefined,
	me: string | undefined,
): Effort {
	const effort: Effort = { ...ride, calledZone: 0, unreadable: false };
	if (game?.phase !== 'running') return effort;
	const ask = (pct: number | undefined) => {
		effort.targetWatts = Math.max(effort.targetWatts, (pct ?? 0) * ride.ftp);
	};
	const mine = me ? game.riders?.[me] : undefined;
	// A target of the rider's own — the ramp's line, the relay's front or its
	// wheel, the eliminated rider's easy spin — asks like a block, and still
	// asks of a rider who has stopped pedalling under it.
	ask(mine?.targetPct);
	if (mine?.eliminated) return effort;
	switch (game.mode) {
		case 'backyard-ramp':
		case 'collective-ramp':
		case 'team-relay':
			break;
		case 'floor-is-lava':
			effort.calledZone = game.calledZone ?? 0;
			break;
		case 'watt-golf':
			// Every hole is 60–110 % of FTP, carried only as the line.
			ask(game.linePct);
			break;
		case 'sprint-roulette':
			// The window rides the game from its klaxon to its end, never
			// tick.sprint — which only the coach's own sprint sets.
			if (game.roundStartsAtMs) effort.sprinting = true;
			break;
		default:
			effort.unreadable = true;
	}
	return effort;
}

/**
 * A recovery valley (docs/SPEC.md, "The roadside"): the ride asks nothing
 * harder than Z1, active recovery, and no sprint is on. What a bottle waits
 * for, so it lands on an easy block and never across an interval.
 *
 * No target at all counts: a paused session, a rider who has stopped
 * pedalling or left the ride can take a bottle this second.
 */
export function inRecoveryValley(effort: Effort): boolean {
	if (effort.sprinting || effort.unreadable) return false;
	if (effort.calledZone > 1) return false;
	if (effort.targetWatts <= 0 || effort.ftp <= 0) return true;
	return zoneOf(effort.targetWatts, effort.ftp) === 1;
}

/** A bottle, announced the way every arrival is — the rider's valley has come. */
export function bottleArrival(
	bottle: { fromId: string; from: string; at: number },
	channel: { href: string },
): Arrival {
	return {
		kind: 'bottle',
		tag: `bottle-${bottle.fromId}`,
		at: bottle.at,
		title: `${bottle.from} handed you a bottle`,
		body: '',
		href: channel.href,
		// Held until now on purpose, so it announces even with the channel open.
		reading: false,
		from: bottle.from,
	};
}

/**
 * Who a bottle from this screen goes to: the rider being watched, out of the
 * session's own riders — never yourself, and never someone the hub would
 * refuse it for, since a bottle lands only on a rider in the session. The
 * watched rider is the session's followed one (session/follow.ts), so the
 * phone's instrument and its bottle name the same person.
 */
export function bottleFor(
	riders: LiveRider[],
	focusId: string | null,
): LiveRider | null {
	return followedRider(
		riders.filter((rider) => rider.inSession && !rider.you),
		focusId,
	);
}
