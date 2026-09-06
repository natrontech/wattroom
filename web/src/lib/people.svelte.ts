/**
 * Faces by id (#807). A chat line carries `fromId` and a display name, never
 * a face — so the same rider was a coloured initial in the log and a real
 * avatar with a level ring in the column right beside it.
 *
 * Nothing fetches for this. Everything that already loads people — the room's
 * members, the DM heads, the friends list, you — drops what it learned here,
 * and whoever needs a face asks. An id nobody has taught falls back to the
 * initial exactly as before, so no surface waits on it.
 */
export interface Face {
	id: string;
	avatarUrl?: string;
	avatarPreset?: string;
	totalXp?: number;
}

const faces = $state<Record<string, Face>>({});

export const people = {
	/**
	 * Remember these. Writes only what changed: the feeds are polls, and
	 * re-assigning an identical face every 10 s would redraw every avatar in
	 * an open chat for nothing.
	 */
	learn(list: readonly (Face | undefined | null)[]): void {
		for (const person of list) {
			if (!person?.id) continue;
			const known = faces[person.id];
			if (
				known &&
				known.avatarUrl === person.avatarUrl &&
				known.avatarPreset === person.avatarPreset &&
				known.totalXp === person.totalXp
			)
				continue;
			faces[person.id] = {
				id: person.id,
				avatarUrl: person.avatarUrl,
				avatarPreset: person.avatarPreset,
				totalXp: person.totalXp,
			};
		}
	},
	face(id: string | undefined | null): Face | undefined {
		return id ? faces[id] : undefined;
	},
};
