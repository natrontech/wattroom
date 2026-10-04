// Where the power-by-duration bars sit (#3769). Three bars per duration, so a
// group is three bars, two gaps and a breath either side: the bar width comes
// from the group, never the other way round, and adjacent groups cannot meet
// however narrow the chart gets. The reference label lives in a left gutter,
// so no bar can sit under it.

export const BARS_PER_GROUP = 3;
export const BAR_GAP = 3;
export const GROUP_PAD = 10; // total breath in a group, split either side
export const GUTTER = 40; // holds the reference label ("1,000 W" at 12px)
export const MIN_BAR = 6;
export const MAX_BAR = 52;

export type PowerCurveGeometry = {
	width: number;
	groupW: number;
	barW: number;
	groupCentre: (group: number) => number;
	barX: (group: number, bar: number) => number;
};

export function powerCurveGeometry(
	measured: number,
	groups: number,
): PowerCurveGeometry {
	const minWidth = GUTTER + groups * (GROUP_PAD + BARS_PER_GROUP * MIN_BAR);
	const width = Math.max(measured, minWidth);
	const groupW = (width - GUTTER) / groups;
	const barW = Math.min(
		MAX_BAR,
		(groupW - GROUP_PAD - (BARS_PER_GROUP - 1) * BAR_GAP) / BARS_PER_GROUP,
	);
	const groupCentre = (group: number) => GUTTER + group * groupW + groupW / 2;
	const barX = (group: number, bar: number) =>
		groupCentre(group) + (bar - 1) * (barW + BAR_GAP) - barW / 2;
	return { width, groupW, barW, groupCentre, barX };
}
