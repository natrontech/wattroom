/**
 * Rider profile, stored locally until accounts land (#16).
 *
 * FTP is the number every workout scales to, so a bad value silently makes every
 * session wrong rather than broken — it is bounds-checked on read, and a stored
 * value outside the range is discarded rather than used.
 */
const KEY = 'wattroom.profile.v1';

export const PROFILE_LIMITS = {
	minFtp: 50,
	maxFtp: 600,
	minKg: 30,
	maxKg: 200,
} as const;

export interface Profile {
	ftp: number;
	kg: number;
	/** ms epoch of the ramp test that set this FTP, if one did. */
	ftpMeasuredAt?: number;
	/**
	 * Sprint setup (#30/#41): the slope a sprint moment throws you onto, and
	 * whether this is a single-speed setup (Zwift Cog) — where slope mode has
	 * no usable range, so sprints run as a high ERG target instead.
	 */
	sprintGrade: number;
	singleSpeed: boolean;
	/**
	 * Whether live heart rate leaves this browser into a room (#62, ADR-0008).
	 * Default true — visible-in-room is the product promise — but stopping it
	 * is one action, and the rider's own .fit is unaffected either way.
	 */
	shareHr: boolean;
}

export const DEFAULT_PROFILE: Profile = {
	ftp: 200,
	kg: 75,
	shareHr: true,
	sprintGrade: 5,
	singleSpeed: false,
};

function inRange(value: unknown, min: number, max: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
	);
}

export function parseProfile(value: unknown): Profile {
	if (typeof value !== 'object' || value === null)
		return { ...DEFAULT_PROFILE };
	const { ftp, kg, ftpMeasuredAt, shareHr, sprintGrade, singleSpeed } =
		value as Record<string, unknown>;
	return {
		ftp: inRange(ftp, PROFILE_LIMITS.minFtp, PROFILE_LIMITS.maxFtp)
			? ftp
			: DEFAULT_PROFILE.ftp,
		kg: inRange(kg, PROFILE_LIMITS.minKg, PROFILE_LIMITS.maxKg)
			? kg
			: DEFAULT_PROFILE.kg,
		ftpMeasuredAt:
			typeof ftpMeasuredAt === 'number' ? ftpMeasuredAt : undefined,
		shareHr: typeof shareHr === 'boolean' ? shareHr : true,
		sprintGrade: inRange(sprintGrade, 1, 15)
			? sprintGrade
			: DEFAULT_PROFILE.sprintGrade,
		singleSpeed: typeof singleSpeed === 'boolean' ? singleSpeed : false,
	};
}

export function createProfileStore() {
	let profile = $state<Profile>(load());

	function load(): Profile {
		if (typeof localStorage === 'undefined') return { ...DEFAULT_PROFILE };
		try {
			const raw = localStorage.getItem(KEY);
			return raw ? parseProfile(JSON.parse(raw)) : { ...DEFAULT_PROFILE };
		} catch {
			return { ...DEFAULT_PROFILE };
		}
	}

	return {
		get current(): Profile {
			return profile;
		},
		/** Returns an error message, or null. */
		update(next: Partial<Profile>): string | null {
			// Rejected, not coerced. parseProfile falls back to the default for stored
			// junk, which is right on read — but silently turning a typed 900 into 200
			// gives the rider a wrong FTP they have no reason to doubt.
			if (
				next.ftp !== undefined &&
				!inRange(next.ftp, PROFILE_LIMITS.minFtp, PROFILE_LIMITS.maxFtp)
			) {
				return `FTP has to be between ${PROFILE_LIMITS.minFtp} and ${PROFILE_LIMITS.maxFtp} W.`;
			}
			if (
				next.kg !== undefined &&
				!inRange(next.kg, PROFILE_LIMITS.minKg, PROFILE_LIMITS.maxKg)
			) {
				return `Weight has to be between ${PROFILE_LIMITS.minKg} and ${PROFILE_LIMITS.maxKg} kg.`;
			}
			const merged = parseProfile({ ...profile, ...next });
			try {
				localStorage.setItem(KEY, JSON.stringify(merged));
			} catch {
				return 'Could not save — this browser is not allowing local storage.';
			}
			profile = merged;
			return null;
		},
	};
}
