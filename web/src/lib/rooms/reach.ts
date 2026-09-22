/**
 * How far a room reaches, as one ladder (#1204, ADR-0038, ADR-0039). The
 * server keeps two columns — `listed` is the public directory, `crewVisible`
 * the crew's sidebar — and a room listed to strangers but hidden from its own
 * crew is not a state anyone means, so the product walks them as one
 * question with three steps.
 *
 * A crew row's permission toggle (`CrewRooms`) asks it; the room's own
 * settings asked it too until the room dissolved into the crew (#2454), and
 * the words stay here, one vocabulary, until the row goes as well (#2460).
 */

export type Reach = 'members' | 'crew' | 'everyone';

/**
 * The step names. The only place they are written: a surface that needs a
 * word for a reach takes it from here rather than retyping it.
 */
export const REACH_LABELS: Record<Reach, string> = {
	members: 'Only its members',
	crew: 'Open to the crew',
	everyone: 'Everyone on WattRoom',
};

/**
 * The same steps as something you DO. A row says where a room stands; a
 * button says what pressing it does (ux.md: items say what happens), and the
 * two were one string — so an open room's only descriptor was a ghost button
 * reading "Only its members", which is the truth upside down (#2177).
 *
 * The words are the step names above with a verb, not a second vocabulary.
 */
export const REACH_ACTIONS: Record<Reach, string> = {
	members: 'Shut to its members',
	crew: 'Open to the crew',
	everyone: 'List for everyone on WattRoom',
};
