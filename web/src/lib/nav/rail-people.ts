/**
 * The line of names under a voice channel's row in the sidebar (#438, #2447):
 * who is in there, without going in. It prints what fits in 224 px and
 * counts the rest — one 10 px line, not a strip of faces, because stacking
 * names Discord-style would quadruple every busy channel's height and cost the
 * column the glance it exists for (ADR-0010).
 */

/** Names the line prints before it starts counting instead. */
export const RAIL_NAMES = 3;

/** The names the line prints, how many it hid, and how it reads. */
export function railPeople(riders: readonly string[] | undefined): {
	shown: string[];
	more: number;
	label: string;
} {
	const all = riders ?? [];
	const shown = all.slice(0, RAIL_NAMES);
	const more = all.length - shown.length;
	return {
		shown,
		more,
		label: shown.join(', ') + (more > 0 ? ` +${more}` : ''),
	};
}
