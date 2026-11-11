import type {
	Rider,
	ServerTick,
	SessionRoute,
	SessionState,
	StartLine,
} from '#lib/protocol.ts';
import type { CueId } from '#lib/sound/cue-catalogue.ts';
import { climbsOf, type ClimbClass } from '#lib/road/climbs.ts';
import { crewDistanceM } from '#lib/road/match.ts';
import { turnedRound } from '#lib/road/road.ts';
import { classChips } from '#lib/road/route-row.ts';
import type { PinnedRoad } from '#lib/workout/road-workout.ts';
import type { Workout } from '#lib/workout/types.ts';

/**
 * The start line (#3228): a session picked on a road, before its count-in.
 * Who stands on it and what they have ready comes from the hub; what the
 * screen says about it, and when the coach may start, is decided here.
 */

/** What of a tick decides whether a place draws the start line. */
export type LineTick = Pick<ServerTick, 'startLine' | 'game'> & {
	state: Pick<SessionState, 'phase' | 'route'>;
};

/**
 * Whether a place draws the start line (#3228): its session is picked on a
 * road and not started, and no game holds the place. Both places a road
 * session waits on read this — the voice channel's lounge, and the session's
 * own page, where every road session has opened since sessions left the
 * call (#4389, #4504) — so the coach's Start the ride is never missing.
 */
export function showsStartLine(tick: LineTick | null | undefined): boolean {
	return (
		!!tick?.startLine &&
		!!tick.state.route &&
		tick.state.phase === 'idle' &&
		!tick.game
	);
}

/** One rider on the line, as the line's rows draw them. */
export type LineRider = {
	id: string;
	name: string;
	you: boolean;
	trainer: boolean;
	heartRate: boolean;
	ftp: number;
	/** The FTP nobody chose (ADR-0048): said to be a guess. */
	ftpGuess: boolean;
};

export type StartLineView = {
	/** Joined and in the channel, in roster order. */
	onLine: LineRider[];
	/** In the channel, not on the line. */
	beside: string[];
	/** Said they are in on the plan, and not here yet. */
	awaited: string[];
	/** You are on the line. */
	youOn: boolean;
	/** Why the coach cannot start the ride yet; null once they can. */
	wait: string | null;
};

/** The issue's rule: the ride starts once one trainer on the line is ready. */
export const WAIT_FOR_TRAINER =
	'Start the ride once a rider on the line has a trainer paired.';

export function startLineView(
	line: StartLine,
	roster: Rider[],
	me: string | undefined,
): StartLineView {
	const onLine = roster.flatMap((r) => {
		const ready = line.ready[r.id];
		return ready
			? [
					{
						id: r.id,
						name: r.name,
						you: r.id === me,
						trainer: !!ready.trainer,
						heartRate: !!ready.heartRate,
						ftp: r.ftpWatts,
						ftpGuess: r.ftpSource === 'default',
					},
				]
			: [];
	});
	return {
		onLine,
		beside: roster.filter((r) => !line.ready[r.id]).map((r) => r.name),
		awaited: (line.awaited ?? []).map((r) => r.name),
		youOn: !!me && !!line.ready[me],
		wait: onLine.some((r) => r.trainer) ? null : WAIT_FOR_TRAINER,
	};
}

/** The road card: what the line is about to ride. */
export type RoadCard = {
	/** The generated name, which is as far as the crew may see it (#3055). */
	name: string;
	/** km a–b on the crew's cut, one decimal. */
	fromKm: string;
	toKm: string;
	/** The climbs on that stretch as class chips, hardest first. */
	chips: ClimbClass[];
	/** How long it takes at crew pace: the session's length. */
	seconds: number;
	/** Where Terrain Match starts the workout, when it moved it off km 0. */
	terrainKm: string | null;
};

const km = (m: number) => (m / 1000).toFixed(1);

export function roadCard(
	route: SessionRoute,
	cut: PinnedRoad | null,
	workout: Workout | null,
	seconds: number,
): RoadCard {
	const fromM = route.fromM;
	// A road workout's blocks end at metres (#3499): its stretch is the
	// road's own. A workout on a route goes as far as the crew's pace takes it.
	const pinned = !!cut?.stepEndM;
	const road = cut && (route.reverse ? turnedRound(cut.road) : cut.road);
	const distanceM =
		!cut || !road
			? route.lengthM - fromM
			: pinned
				? cut.toM - cut.fromM
				: workout
					? crewDistanceM(road, workout, fromM, false, route.loop)
					: road.length - fromM;
	const toM = route.loop
		? fromM + distanceM
		: Math.min(fromM + distanceM, route.lengthM);
	const length = road?.length ?? route.lengthM;
	// A looped road comes round again: a climb is on the ride when any lap of
	// it starts inside the stretch.
	const onRide = (startM: number) => {
		for (let at = startM; at < toM; at += length) if (at >= fromM) return true;
		return false;
	};
	const chips = road
		? classChips(climbsOf(road).filter((c) => onRide(c.startM)))
		: [];
	return {
		name: route.genName,
		fromKm: km(fromM),
		toKm: km(toM),
		chips,
		seconds,
		terrainKm: cut && !pinned && fromM > 0 ? km(fromM) : null,
	};
}

/**
 * What the line says out loud as it changes (AGENTS.md: every state change
 * gets a sound). One cue a change, the one that matters most: a trainer
 * coming ready, then a rider stepping on or off, then the line opening.
 */
export function lineCue(
	before: StartLine | null,
	after: StartLine | null,
): { id: CueId; shift?: number } | null {
	if (!after) return null;
	if (!before) return { id: 'block' };
	const trainers = (line: StartLine) =>
		Object.values(line.ready).filter((r) => r.trainer).length;
	const riders = (line: StartLine) => Object.keys(line.ready).length;
	if (trainers(after) > trainers(before)) return { id: 'equip' };
	if (riders(after) > riders(before)) return { id: 'join', shift: 5 };
	if (riders(after) < riders(before)) return { id: 'leave', shift: 5 };
	return null;
}
