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
}>({
	seated: false,
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
	if (sameSeat(last, next)) return;
	last = next;
	// The boolean is the only reactive part, and it changes when a surface
	// takes or gives up the seat — never with the rect. Assigned flat, never
	// guarded by a read of itself: this runs inside a surface's attachment,
	// and an effect that reads what it writes is invalidated by its own
	// write — which tore the attachment down, re-attached it, published
	// again, and wedged the room (#502). An unchanged boolean notifies
	// nobody, so the guard only ever saved a no-op.
	stageSlot.seated = !!next;
	listener?.(next);
}

/**
 * Offer `node` as the player's seat for as long as it is attached and mostly
 * on screen. Returns the teardown, so it drops straight into an attachment.
 *
 * The hole is re-measured every animation frame while offered (#395): a
 * banner above it, a message landing, a tab switch — anything that moves the
 * hole without resizing it — fires no observer, and a scroll listener paints
 * a frame behind. One getBoundingClientRect per frame, a publish only when
 * the numbers changed.
 * ponytail: a rAF poll of one rect, not a MutationObserver over every ancestor.
 */
export function offerSeat(node: HTMLElement, priority = 0): () => void {
	let visible = true;
	let raf: number = 0;
	const offer = { priority, seat: null as Seat | null };
	offers.set(node, offer);
	const publish = () => {
		offer.seat = seatOf(node.getBoundingClientRect(), visible);
		settle();
	};
	// Every 100 ms, not every frame. Each publish is a getBoundingClientRect,
	// which forces layout; sixty of those a second next to a playing video and
	// a voice call is enough to make the video stutter (rider report). A box
	// that follows a moved hole a tenth of a second later is not noticeable;
	// dropped frames in the video are.
	const frame = () => {
		publish();
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
	raf = setInterval(frame, MEASURE_MS) as unknown as number;
	return () => {
		clearInterval(raf);
		intersect.disconnect();
		offers.delete(node);
		settle();
	};
}
