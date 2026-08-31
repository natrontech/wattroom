/**
 * Where a dragged pane lands (#316) — pure geometry, no DOM.
 *
 * CSS `resize` gives one corner and no guides, so a dock could only ever grow
 * down-right and never be tucked anywhere on purpose. These are the two sums
 * behind grabbing any edge: which lines an edge clicks to, and what rect the
 * pane ends up with once the limits have had their say.
 */
export const EDGES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type Edge = (typeof EDGES)[number];

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface Limits {
	minW: number;
	minH: number;
	maxW: number;
	maxH: number;
}

/** Guide lines, in viewport pixels. */
export interface Guides {
	x: number[];
	y: number[];
}

/**
 * Within this many pixels an edge clicks to a guide — and lets go the moment
 * you keep pulling. A hint, never a trap.
 */
export const SNAP = 8;

/** The nearest guide within reach, else the value untouched. */
export function snap(value: number, guides: number[]): number {
	let best = value;
	let gap = SNAP;
	for (const guide of guides) {
		const distance = Math.abs(value - guide);
		if (distance <= gap) {
			gap = distance;
			best = guide;
		}
	}
	return best;
}

/**
 * Slide a whole pane so that whichever of its leading, middle or trailing
 * edge is nearest a guide lands on it — that middle candidate is what makes
 * "centred" a place you can drop something.
 */
export function snapSpan(
	value: number,
	size: number,
	guides: number[],
): number {
	// An edge out of reach reports back the value it was given, so only the
	// candidates that actually moved are in the running — otherwise a
	// no-op always "wins" for being nearest.
	const caught = [
		snap(value, guides),
		snap(value + size / 2, guides) - size / 2,
		snap(value + size, guides) - size,
	].filter((candidate) => candidate !== value);
	return caught.length === 0
		? value
		: caught.reduce((best, candidate) =>
				Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
			);
}

/**
 * Where a pane lands when `edge` is dragged by (dx, dy). Only the dragged
 * edges move: hitting the minimum from the west pins the east edge, which is
 * the difference between resizing a pane and walking it across the screen.
 */
export function resizeRect(
	start: Rect,
	edge: Edge,
	dx: number,
	dy: number,
	limits: Limits,
	guides: Guides,
): Rect {
	const west = edge.includes('w');
	const east = edge.includes('e');
	const north = edge.includes('n');
	const south = edge.includes('s');

	const left = west ? snap(start.left + dx, guides.x) : start.left;
	const right = east
		? snap(start.left + start.width + dx, guides.x)
		: start.left + start.width;
	const top = north ? snap(start.top + dy, guides.y) : start.top;
	const bottom = south
		? snap(start.top + start.height + dy, guides.y)
		: start.top + start.height;

	const width = Math.min(limits.maxW, Math.max(limits.minW, right - left));
	const height = Math.min(limits.maxH, Math.max(limits.minH, bottom - top));
	return {
		left: west ? right - width : left,
		top: north ? bottom - height : top,
		width,
		height,
	};
}

export const CURSOR: Record<Edge, string> = {
	n: 'ns',
	s: 'ns',
	e: 'ew',
	w: 'ew',
	ne: 'nesw',
	sw: 'nesw',
	nw: 'nwse',
	se: 'nwse',
};
/** Grab depth: a thin strip along an edge, a squarer patch at a corner. */
const GRIP = 6;
const CORNER = 14;

export function gripStyle(edge: Edge): string {
	const north = edge.includes('n');
	const south = edge.includes('s');
	const west = edge.includes('w');
	const east = edge.includes('e');
	const size = (north || south) && (west || east) ? CORNER : GRIP;
	const x = west
		? `left:0;width:${size}px`
		: east
			? `right:0;width:${size}px`
			: `left:${CORNER}px;right:${CORNER}px`;
	const y = north
		? `top:0;height:${size}px`
		: south
			? `bottom:0;height:${size}px`
			: `top:${CORNER}px;bottom:${CORNER}px`;
	return `${x};${y}`;
}
