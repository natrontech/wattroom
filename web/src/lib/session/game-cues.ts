import type { GameState } from '$lib/protocol';
import type { CueId } from '$lib/sound/cue-catalogue';

/**
 * What a game mode should say out loud, given how its state just moved (#845).
 *
 * Modes announced their outcomes — knocked out, podium — and never their
 * instructions, which is backwards: a mode is exactly when a rider is at
 * threshold and least able to read a screen, and Watt Golf hides the meter
 * by design. `SprintMoment` is the template; this brings the other modes up
 * to it.
 *
 * Pure on purpose. Every decision here is "these two states, one rider", so
 * the whole layer is testable without a browser, and the panel keeps no
 * memory of its own beyond the previous state — the ad-hoc `Set` and boolean
 * it used to carry are what silenced a second game in the same panel (#834).
 */
export interface GameCue {
	id: CueId;
	/** Semitones. A cue reused at a different weight rather than a new sound. */
	shift?: number;
}

/**
 * Modes whose round boundary is a new target with nothing else announcing it.
 * Watt Golf has its own run-in countdown and Sprint Roulette has its klaxon
 * below, so neither wants a second cue on the same moment.
 */
const RAMP_MODES = new Set(['backyard-ramp', 'collective-ramp']);

export function gameCues(
	before: GameState | null | undefined,
	now: GameState,
	me: string | undefined,
): GameCue[] {
	// Nothing to compare against, or a different game entirely: this is a
	// first look, not a change. Announcing it would greet every rider with
	// the state of a game already in progress.
	if (!before || before.mode !== now.mode) return [];

	const cues: GameCue[] = [];
	const mine = me ? now.riders?.[me] : undefined;
	const wasMine = me ? before.riders?.[me] : undefined;

	// The room's drama, for everyone: somebody is out. One cue however many
	// went together — a backyard round can take four at once, and four
	// identical stings is a pile-up, not an announcement.
	const newlyOut = Object.entries(now.riders ?? {}).some(
		([id, rider]) => rider.eliminated && !before.riders?.[id]?.eliminated,
	);
	if (newlyOut) cues.push({ id: 'elimination' });

	// Your own life, which is yours alone: eight riders' lives burning would
	// be noise. Silent when it was the last one — being knocked out already
	// has a cue, and the two would land together.
	const lives = mine?.lives ?? 0;
	const livesBefore = wasMine?.lives ?? 0;
	if (livesBefore > 0 && lives < livesBefore && !mine?.eliminated)
		cues.push({ id: 'elimination', shift: 12 });

	// Team Relay: you are on front now, at 110 % FTP. The most actionable
	// event in the product, and the one that was silent.
	if (mine?.onFront && !wasMine?.onFront) cues.push({ id: 'handoff' });

	// Floor is Lava: the called zone moved, and 5 s later it starts costing
	// lives. Same cue as a workout's block change, because it is the same
	// thing — the target just changed.
	if (now.calledZone && now.calledZone !== before.calledZone)
		cues.push({ id: 'block' });

	// A ramp round: the line climbs, so this is a target change too.
	if (RAMP_MODES.has(now.mode) && now.round && now.round !== before.round)
		cues.push({ id: 'block' });

	// Sprint Roulette's klaxon (#1587): nothing sounded it — the shell's
	// klaxon is keyed on the room's own sprint, which this mode never sets.
	// The window appears on the tick three seconds before it opens, so that
	// tick IS the klaxon; the 3-2-1 and the gun follow once the start rides
	// the wire (#1578).
	if (
		now.mode === 'sprint-roulette' &&
		now.roundEndsAtMs &&
		now.roundEndsAtMs !== before.roundEndsAtMs
	)
		cues.push({ id: 'klaxon' });

	// The podium, once — guarded by the phase moving rather than by the
	// panel remembering, so a second game gets its fanfare back (#834).
	if (
		now.phase === 'done' &&
		before.phase !== 'done' &&
		(now.podium?.length ?? 0) > 0
	)
		cues.push({ id: 'fanfare' });

	return cues;
}

/**
 * What Watt Golf's run-in owes the rider this instant, or null for "nothing".
 *
 * The hole is "hit X W for 10 s, starting in 20 s" with the meter hidden
 * throughout, so the rider is blind by design and the count-in is the only
 * thing that can tell them to get ready. A clock rather than a state change,
 * which is why it is separate — but the decision still belongs here, so the
 * panel is left holding nothing but the memo of what it last played.
 */
export type GolfMoment = { tick: number } | { go: true } | null;

export function golfMoment(game: GameState, now: number): GolfMoment {
	if (game.mode !== 'watt-golf' || game.phase !== 'running') return null;
	// Hidden spans the run-in AND the hole; the hole opening is the anchor.
	if (!game.meterHidden || !game.roundEndsAtMs) return null;
	const msLeft = game.roundEndsAtMs - now;
	// The gun, for the first second after the hole opens. Bounded on purpose:
	// a throttled tab that missed the moment entirely should stay quiet
	// rather than fire the gun into a hole already under way. (Bounding it
	// explicitly also keeps this off `Math.ceil(-0.001) === -0`, which
	// compares equal to 0 and made the open-ended case pass by accident.)
	if (msLeft <= 0) return msLeft > -1000 ? { go: true } : null;
	// Only the last three, like every other countdown in the product.
	const left = Math.ceil(msLeft / 1000);
	return left <= 3 ? { tick: left } : null;
}
