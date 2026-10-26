// What an ID frame shows (#3222), counted on the CPU: what appeared between
// two frames, what flickers as the camera moves, and what covers your figure.
// Pure, so world-ids.test.ts pins each without a GPU.

/** A pixel's ID: the object's number in the low 16 bits, its instance's in the high 16. 0 is nothing drawn. */
export type Ids = Uint32Array;
/** The object half of an ID. */
export const OBJECT_BITS = 0xffff;
/** The IDs a frame holds, each with the model it draws. */
export type Shown = Map<number, number>;

/**
 * What appeared between two frames: each ID the frame before did not hold,
 * or held with another model, with the pixels it covers now that it did not
 * cover then, where that is more than `minPx`. One that comes in from the
 * frame's edge or from behind something was held, only out of sight; a
 * model swapped in place counts only what its outline gained.
 */
export function appeared(
	held: Shown,
	shown: Shown,
	before: Ids,
	after: Ids,
	minPx: number,
): Map<number, number> {
	const gained = new Map<number, number>();
	for (let i = 0; i < after.length; i++) {
		const id = after[i];
		if (id && id !== before[i] && held.get(id) !== shown.get(id))
			gained.set(id, (gained.get(id) ?? 0) + 1);
	}
	for (const [id, px] of gained) if (px <= minPx) gained.delete(id);
	return gained;
}

/**
 * Pixels that flip and flip back across three camera positions a step
 * apart: z-fighting. An edge the step moves only ever sweeps a pixel once.
 */
export function flickers(a: Ids, b: Ids, c: Ids): number {
	let n = 0;
	for (let i = 0; i < b.length; i++) if (a[i] === c[i] && b[i] !== a[i]) n++;
	return n;
}

export type Cover = { px: number; reach: number };

/**
 * Your mask's pixels, and for each ID that is not you the pixels of it it
 * covers and how far up it reaches: 0 at your mask's lowest row, 1 at its
 * highest. Rows run bottom up, as the target reads back.
 */
export function hidden(
	full: Ids,
	mask: Ids,
	self: Set<number>,
	width: number,
): { px: number; by: Map<number, Cover> } {
	let px = 0;
	let lo = Infinity;
	let hi = -Infinity;
	const rows = new Map<number, Cover>();
	for (let i = 0; i < mask.length; i++) {
		if (!mask[i]) continue;
		px++;
		const row = Math.floor(i / width);
		lo = Math.min(lo, row);
		hi = Math.max(hi, row);
		const id = full[i];
		if (self.has(id & OBJECT_BITS)) continue;
		const c = rows.get(id) ?? { px: 0, reach: row };
		c.px++;
		c.reach = Math.max(c.reach, row);
		rows.set(id, c);
	}
	for (const c of rows.values()) c.reach = (c.reach - lo) / (hi - lo || 1);
	return { px, by: rows };
}
