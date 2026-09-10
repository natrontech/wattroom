/**
 * How far a room reaches, as one ladder (#1204, ADR-0038, ADR-0039). The
 * server keeps two columns — `listed` is the public directory, `crewVisible`
 * the crew's sidebar — and a room listed to strangers but hidden from its own
 * crew is not a state anyone means, so the product walks them as one
 * question with three steps.
 *
 * Two surfaces ask it: the room's own settings (`RoomReach`) and a crew row's
 * permission toggle (`CrewRooms`). The words live here because they used to
 * live in both, in two vocabularies — a rider who shut a room from the crew
 * page could not recognise the setting in the room, and "private" there
 * silently meant this ladder's bottom step (#2007).
 */

export type Reach = 'members' | 'crew' | 'everyone';

/** Bottom to top — the order both surfaces present. */
export const REACH_ORDER: readonly Reach[] = ['members', 'crew', 'everyone'];

/**
 * The step names. The only place they are written: a surface that needs a
 * word for a reach takes it from here rather than retyping it.
 */
export const REACH_LABELS: Record<Reach, string> = {
	members: 'Only its members',
	crew: 'Open to the crew',
	everyone: 'Everyone on WattRoom',
};

/** What each step actually does — including the half riders assume and
 * should not: being findable is not being readable. */
export const REACH_HINTS: Record<Reach, string> = {
	members:
		'Its members, and the crew-mates you let in from the Members place. The rest of the crew sees that it exists and that it is private — not a way in.',
	crew: 'Everyone in the crew sees it in their sidebar and can walk in without a code. This is how a new room starts.',
	everyone:
		'Anyone signed in can find it by name in the directory and join — which puts them in the crew. They see its name and icon first, nothing about who rides here or what you did.',
};

/** The two columns a step sets. */
export const REACH_FLAGS: Record<
	Reach,
	{ crewVisible: boolean; listed: boolean }
> = {
	members: { crewVisible: false, listed: false },
	crew: { crewVisible: true, listed: false },
	everyone: { crewVisible: true, listed: true },
};

/** Which step a room's two columns put it on. */
export function reachOf(listed: boolean, crewVisible: boolean): Reach {
	return listed ? 'everyone' : crewVisible ? 'crew' : 'members';
}

/**
 * A step's name, sharpened with the crew's own name where the surface knows
 * it — "Open to the crew — Tuesday Crew" beats the generic middle step.
 */
export function reachLabel(step: Reach, crewName?: string): string {
	const label = REACH_LABELS[step];
	return step === 'crew' && crewName ? `${label} — ${crewName}` : label;
}

export interface ReachStep {
	key: Reach;
	label: string;
	hint: string;
}

/** The ladder, bottom step first. */
export function reachSteps(crewName?: string): ReachStep[] {
	return REACH_ORDER.map((key) => ({
		key,
		label: reachLabel(key, crewName),
		hint: REACH_HINTS[key],
	}));
}
