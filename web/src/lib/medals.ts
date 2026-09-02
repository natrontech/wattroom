/**
 * The docs/SPEC.md medals, by their wire kind — names and criteria are fixed
 * there, never invented per surface. One home (code-quality.md): the summary
 * poster and the rider's page read the same table.
 */
export const MEDAL_META: Record<string, { name: string; criterion: string }> = {
	diesel: { name: 'Diesel', criterion: 'lowest power variability' },
	metronome: { name: 'Metronome', criterion: 'best execution score' },
	hammer: { name: 'Hammer', criterion: 'best 5 s w/kg' },
	lanterne_rouge: {
		name: 'Lanterne Rouge',
		criterion: 'last on the podium metric, but finished',
	},
};

/** Display name for a wire kind; an unknown kind shows as itself. */
export function medalName(kind: string): string {
	return MEDAL_META[kind]?.name ?? kind;
}
