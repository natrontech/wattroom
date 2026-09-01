/**
 * Where the room wants the jukebox player, in viewport pixels (#316).
 *
 * The player is ONE iframe living on the app frame so music survives
 * navigation (#216), and moving an iframe in the DOM reloads it — playback
 * and the YT player object die with it. So the stage never adopts the
 * player: it measures the hole it left and publishes the rect, and the fixed
 * dock flies there. Null means "nobody is offering a seat" and the dock goes
 * back to floating, which is also how RMF's visible-while-playing rule holds
 * when the room page unmounts or the stage scrolls away.
 */
export interface Seat {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const stageSlot = $state<{ seat: Seat | null }>({ seat: null });

/** Below this much of the stage on screen, the dock takes the video back. */
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

/**
 * Offer `node` as the player's seat for as long as it is attached and mostly
 * on screen. Returns the teardown, so it drops straight into an attachment.
 *
 * The hole is re-measured every animation frame while offered (#395). A
 * banner above the stage, a message landing, a tab switch — anything that
 * moves the hole without resizing it — fires no observer, and a scroll
 * listener paints a frame behind. One getBoundingClientRect per frame, and
 * a publish only when the numbers changed.
 * ponytail: a rAF poll of one rect, not a MutationObserver over every ancestor.
 */
export function offerSeat(node: HTMLElement): () => void {
	let visible = true;
	let raf = 0;
	// The first publish runs inside the stage's attachment, which is an
	// effect: comparing against `stageSlot.seat` there would make that effect
	// depend on the state it writes (#414's shape). The last seat is kept
	// here instead, so the store is only ever written.
	let last: Seat | null = null;
	const publish = () => {
		const next = seatOf(node.getBoundingClientRect(), visible);
		if (sameSeat(last, next)) return;
		last = next;
		stageSlot.seat = next;
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
		stageSlot.seat = null;
	};
}
