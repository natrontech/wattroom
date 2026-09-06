/**
 * Who arrived and who left, between two looks at any set of riders (#854).
 *
 * Screen shares needed this first (#664) and the voice channel needs exactly
 * the same question asked of a different set, so it lives under a name that
 * describes the shape rather than either caller. Your own id is always left
 * out: a cue or a line telling you what you just did is noise, and in the
 * voice case it would fire while you are still clicking Join.
 */
export interface Coming {
	rider: string;
	/** True on arrival, false on departure. */
	live: boolean;
}

export function comingsAndGoings(
	before: ReadonlySet<string>,
	now: ReadonlySet<string>,
	me: string | undefined,
): Coming[] {
	const changes: Coming[] = [];
	for (const rider of now)
		if (!before.has(rider) && rider !== me) changes.push({ rider, live: true });
	for (const rider of before)
		if (!now.has(rider) && rider !== me) changes.push({ rider, live: false });
	return changes;
}
