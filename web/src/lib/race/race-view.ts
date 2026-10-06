import type { ServerTick } from '$lib/protocol';

/**
 * Your race as the RACE page and the team-car radio read it (#3174,
 * ADR-0067): where you stand against your Category's par and among your
 * Category, how far the line is, and which part of the race this is. All of
 * it is the hub's model, timed on the hub's road, so every screen reads the
 * same race.
 */
export interface RaceReadout {
	/** The tick's time, server ms: what the radio spaces its calls by. */
	at: number;
	phase: 'neutral' | 'racing' | 'held' | 'finished';
	/** Seconds ahead of your Category's par (+), behind (−); null before km 0. */
	par: number | null;
	category: string;
	/** Your place among the racers of your Category, and how many they are. */
	place: number;
	of: number;
	/** Metres to the line; 0 once over it. */
	toLine: number;
}

/** The race this tick runs, as you ride it; null when you are not racing. */
export function raceOf(
	tick: ServerTick | null,
	you: string,
): RaceReadout | null {
	const race = tick?.game?.race;
	const racers = tick?.world?.racers;
	const me = racers?.[you];
	if (!race || !racers || !me || race.void) return null;
	const category = me.cat ?? '';
	// Over the line first, by the time they crossed it; then by the road.
	const ahead = (a: typeof me, b: typeof me) =>
		a.finishMs && b.finishMs
			? a.finishMs < b.finishMs
			: !!a.finishMs || (!b.finishMs && a.m > b.m);
	const field = Object.values(racers).filter((r) => (r.cat ?? '') === category);
	const line = race.lineM || tick?.state.route?.lengthM || 0;
	const phase: RaceReadout['phase'] = me.finishMs
		? 'finished'
		: race.neutralised
			? 'held'
			: tick.at < race.klaxonAtMs
				? 'neutral'
				: 'racing';
	return {
		at: tick.at,
		phase,
		// The wire leaves out a par of 0: after km 0, absent is on par.
		par: tick.at < race.klaxonAtMs ? null : (me.par ?? 0),
		category,
		place: 1 + field.filter((r) => r !== me && ahead(r, me)).length,
		of: field.length,
		toLine: me.finishMs ? 0 : Math.max(0, line - me.m),
	};
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
	const teen = n % 100 >= 11 && n % 100 <= 13;
	const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
	return `${n}${suffix}`;
}
