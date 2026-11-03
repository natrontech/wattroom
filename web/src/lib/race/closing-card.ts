import {
	RaceWeightConfirmDays,
	RaceWeightFreezeDays,
	UnrankedDefaultFtp,
	UnrankedDefaultWeight,
	UnrankedFreshWeight,
	UnrankedLate,
	UnrankedUnconfirmedWeight,
	UnrankedUntimeable,
	type RaceBracket,
	type RaceFinisher,
} from '$lib/protocol';

/**
 * A race's section of the closing card (#3779, ADR-0067): the results per
 * Category, the rider's own first, and an unranked rider told why. The hub
 * sends each racer only their own why.
 */

/** Why the race could not place you, and the way back where there is one. */
export interface UnrankedWhy {
	text: string;
	/** A link to where the number is set, or the commissaire's tap (#3629). */
	way?: { href: string; label: string } | 'confirm';
}

export function unrankedWhy(why: string): UnrankedWhy {
	switch (why) {
		case UnrankedDefaultFtp:
			return {
				text: 'Your FTP is the number everyone starts on, so the race could not place you.',
				way: { href: '/settings/profile', label: 'Set your FTP' },
			};
		case UnrankedDefaultWeight:
			return {
				text: 'Your weight is the number everyone starts on, so the race could not place you.',
				way: { href: '/settings/profile', label: 'Set your weight' },
			};
		case UnrankedFreshWeight:
			return {
				text: `Your weight changed in the last ${RaceWeightFreezeDays} days, so you rode unranked. It counts again ${RaceWeightFreezeDays} days after the change.`,
			};
		case UnrankedUnconfirmedWeight:
			return {
				text: `Your weight has not been confirmed in ${RaceWeightConfirmDays} days, so you rode unranked. Confirm it and the next race places you.`,
				way: 'confirm',
			};
		case UnrankedUntimeable:
			return {
				text: "WattRoom held your watts (Don't make me shift), so the race could not time you. Shift for yourself next race to be placed.",
			};
		case UnrankedLate:
			return {
				text: 'You joined after km 0, so you rode alongside. The race places only who started it.',
			};
		default:
			return { text: 'The race could not place you.' };
	}
}

/** The brackets with yours first, the rest in the hub's D–A order. */
export function yoursFirst(results: RaceBracket[], you: string): RaceBracket[] {
	const yours = (b: RaceBracket) =>
		[...(b.placed ?? []), ...(b.unranked ?? [])].some((f) => f.riderId === you);
	return [...results.filter(yours), ...results.filter((b) => !yours(b))];
}

/** A finisher's mark: time from km 0 over the line, else the distance ridden. */
export function finishMark(f: RaceFinisher): string {
	if (f.ms) {
		const s = f.ms / 1000;
		const whole = Math.floor(s);
		return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((s - whole) * 10)}`;
	}
	return `${(f.m / 1000).toFixed(2)} km`;
}
