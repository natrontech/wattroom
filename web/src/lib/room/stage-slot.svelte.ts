/**
 * Where the room wants the jukebox player, in viewport pixels (#316, #445).
 *
 * The player is ONE iframe living on the app frame so music survives
 * navigation (#216), and moving an iframe in the DOM reloads it — playback
 * and the YT player object die with it. So nothing adopts the player: a
 * surface measures the hole it left and offers the rect, and the fixed dock
 * flies to the best offer. Two surfaces offer today — the people column's
 * jukebox deck (the default seat, #445) and the stage when the jukebox is
 * on it (#316), which outranks the column. No offer means the dock floats,
 * which is also how RMF's visible-while-playing rule holds off the room page.
 */
/**
 * Who may hold the player, weakest first. The highest live offer wins, so a
 * shared screen on the stage and TV mode both take it off the people column.
 */
export const COLUMN_SEAT = 1;
export const STAGE_SEAT = 2;
export const TV_SEAT = 3;

export interface Seat {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Popped out (#445): the rider chose the floating dock over the column's seat. */
const POP_KEY = 'wattroom.jukebox.popout.v1';

function readPopped(): boolean {
	try {
		return localStorage.getItem(POP_KEY) === '1';
	} catch {
		return false;
	}
}

export const stageSlot = $state<{ seat: Seat | null; popped: boolean }>({
	seat: null,
	popped: readPopped(),
});

export function setPopped(popped: boolean): void {
	stageSlot.popped = popped;
	try {
		if (popped) localStorage.setItem(POP_KEY, '1');
		else localStorage.removeItem(POP_KEY);
	} catch {
		/* desk-only preference; losing it costs one click */
	}
}

/** Below this much of a surface on screen, its offer is withdrawn. */
const ENOUGH_VISIBLE = 0.5;

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

function settle() {
	const next = bestOffer(offers.values());
	if (sameSeat(last, next)) return;
	last = next;
	stageSlot.seat = next;
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
	let raf = 0;
	const offer = { priority, seat: null as Seat | null };
	offers.set(node, offer);
	const publish = () => {
		offer.seat = seatOf(node.getBoundingClientRect(), visible);
		settle();
	};
	const frame = () => {
		publish();
		raf = requestAnimationFrame(frame);
	};
	const intersect = new IntersectionObserver(
		([entry]) => {
			visible = entry.intersectionRatio >= ENOUGH_VISIBLE;
			publish();
		},
		{ threshold: [0, ENOUGH_VISIBLE, 1] },
	);
	intersect.observe(node);
	frame();
	return () => {
		cancelAnimationFrame(raf);
		intersect.disconnect();
		offers.delete(node);
		settle();
	};
}
