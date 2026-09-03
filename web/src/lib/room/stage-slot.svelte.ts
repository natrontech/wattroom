/**
 * Where the room wants the jukebox player, in viewport pixels (#316, #445).
 *
 * The player is ONE iframe living on the app frame so music survives
 * navigation (#216), and moving an iframe in the DOM reloads it — playback
 * and the YT player object die with it. So nothing adopts the player: a
 * surface measures the hole it left and offers the rect, and the fixed dock
 * flies to the best offer.
 *
 * The player is never a window the rider drags around any more (#427). It
 * lives in the people column, drops to the nav rail on a window too narrow
 * for that column, and rises to the stage or TV mode when the room is
 * watching together. Four surfaces offer, and the highest live offer wins;
 * the fixed corner is only what is left when a viewport offers nothing at
 * all, which is also how RMF's visible-while-playing rule holds.
 */
/**
 * Who may hold the player, weakest first. The rail is the floor because it is
 * on every framed page: the people column outranks it wherever that column is
 * on screen, and a shared surface outranks both.
 */
export const RAIL_SEAT = 1;
export const COLUMN_SEAT = 2;
export const STAGE_SEAT = 3;
export const TV_SEAT = 4;

export interface Seat {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const stageSlot = $state<{
	/**
	 * Whether ANY surface is holding the player right now. A boolean, not the
	 * rect: it flips when a surface takes the seat or gives it up, a handful
	 * of times a session, and it is the only thing about the seat that render
	 * is allowed to read.
	 *
	 * The rect does NOT live in state (#494). It is measured every animation
	 * frame, and a per-frame value in state means a per-frame pass through
	 * Svelte's effect graph: measure, write state, run the effect that moves
	 * the player, which changes layout, which the next frame measures. Svelte
	 * counts those as nested updates and stops the tree with
	 * effect_update_depth_exceeded — after which the room silently stops
	 * re-rendering and navigating a place does nothing. Geometry goes to the
	 * dock through `onSeat` instead, a plain callback, outside reactivity.
	 */
	seated: boolean;
	/**
	 * Whether a surface ABOVE the people column is offering a seat — the stage,
	 * or TV mode. The column's deck collapses its 200 px hole when one is,
	 * because the hole is then a placeholder for a video already playing
	 * elsewhere on the same screen (#504).
	 *
	 * Deliberately not "who holds the player": that answer depends on the
	 * column's own offer, and the column resizes itself from the answer. Hide
	 * the hole, its offer is withdrawn, the holder changes, the hole comes
	 * back. This counts only offers the column cannot influence, so the cycle
	 * has no edge back.
	 */
	outranked: boolean;
}>({
	seated: false,
	outranked: false,
});

/** Below this much of a surface on screen, its offer is withdrawn. */
const ENOUGH_VISIBLE = 0.5;

/** How often the offered hole is re-measured while it is on screen. */
const MEASURE_MS = 100;

/** The seat a hole's rect amounts to; none while hidden or not laid out. */
export function seatOf(rect: DOMRectReadOnly, visible: boolean): Seat | null {
	return visible && rect.width > 0
		? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
		: null;
}

export function sameSeat(a: Seat | null, b: Seat | null): boolean {
	if (!a || !b) return a === b;
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

const offers = new Map<HTMLElement, { priority: number; seat: Seat | null }>();
// The last seat published, kept here rather than read back from the store:
// the first publish runs inside a surface's attachment (an effect), and an
// effect must never depend on the state it writes.
let last: Seat | null = null;
// ...and the flags too. Reading `stageSlot.seated` or `.outranked` to decide
// whether to write it registers the caller as a dependent, and the caller is
// sometimes a surface's attachment — which then re-runs on every flip:
// teardown, re-register, publish. That mount churn is what #494 died of, so
// every comparison below is against a plain mirror.
let lastSeated = false;
let lastOutranked = false;

/** The highest-priority live offer wins; ties go to whoever offered last. */
export function bestOffer(
	all: Iterable<{ priority: number; seat: Seat | null }>,
): Seat | null {
	let best: { priority: number; seat: Seat } | undefined;
	for (const offer of all) {
		if (!offer.seat) continue;
		if (!best || offer.priority >= best.priority)
			best = { priority: offer.priority, seat: offer.seat };
	}
	return best?.seat ?? null;
}

/**
 * Is a surface above the people column offering? Read by the column's deck,
 * so it must never count the column's own offer — see `outranked`.
 */
export function outranksColumn(
	all: Iterable<{ priority: number; seat: Seat | null }>,
): boolean {
	for (const offer of all)
		if (offer.seat && offer.priority > COLUMN_SEAT) return true;
	return false;
}

/**
 * The dock's geometry, handed over directly. One listener — there is one
 * player — called with the winning rect, or null when nobody is holding it.
 * Registering hands over the seat as it stands, so a dock that mounts late
 * lands in the right place.
 */
let listener: ((seat: Seat | null) => void) | null = null;

export function onSeat(cb: (seat: Seat | null) => void): () => void {
	listener = cb;
	cb(last);
	return () => {
		if (listener === cb) listener = null;
	};
}

function settle() {
	const next = bestOffer(offers.values());
	// Settled before the rect's early return: a surface above the column can
	// appear or go without moving the winning seat by a pixel.
	const outranked = outranksColumn(offers.values());
	if (lastOutranked !== outranked) {
		lastOutranked = outranked;
		stageSlot.outranked = outranked;
	}
	if (sameSeat(last, next)) return;
	last = next;
	// The booleans are the only reactive part, and they change when a surface
	// takes or gives up the seat — never with the rect.
	if (lastSeated !== !!next) {
		lastSeated = !!next;
		stageSlot.seated = !!next;
	}
	listener?.(next);
}

/**
 * Offer `node` as the player's seat for as long as it is attached and mostly
 * on screen. Returns the teardown, so it drops straight into an attachment.
 *
 * The hole is re-measured on a timer while offered (#395): a banner above it,
 * a message landing, a tab switch — anything that moves the hole without
 * resizing it — fires no observer, and a scroll listener paints a frame
 * behind. One getBoundingClientRect per tick, a publish only when the numbers
 * changed.
 *
 * Every MEASURE_MS, not every frame (#513): each publish forces layout, and
 * sixty of those a second next to a playing video and a voice call was enough
 * to make the video stutter (#512). A box that follows a moved hole a tenth of
 * a second later is not noticeable; dropped frames in the video are.
 * ponytail: a timed poll of one rect, not a MutationObserver over every ancestor.
 */
export function offerSeat(node: HTMLElement, priority = 0): () => void {
	let visible = true;
	let measure: number = 0;
	const offer = { priority, seat: null as Seat | null };
	offers.set(node, offer);
	const publish = () => {
		offer.seat = seatOf(node.getBoundingClientRect(), visible);
		settle();
	};
	const intersect = new IntersectionObserver(
		([entry]) => {
			visible = entry.intersectionRatio >= ENOUGH_VISIBLE;
			publish();
		},
		{ threshold: [0, ENOUGH_VISIBLE, 1] },
	);
	intersect.observe(node);
	publish();
	measure = setInterval(publish, MEASURE_MS) as unknown as number;
	return () => {
		clearInterval(measure);
		intersect.disconnect();
		offers.delete(node);
		settle();
	};
}
