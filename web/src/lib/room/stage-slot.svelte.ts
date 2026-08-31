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

/**
 * Offer `node` as the player's seat for as long as it is attached and mostly
 * on screen. Returns the teardown, so it drops straight into an attachment.
 */
export function offerSeat(node: HTMLElement): () => void {
	let visible = true;
	const publish = () => {
		const rect = node.getBoundingClientRect();
		stageSlot.seat =
			visible && rect.width > 0
				? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
				: null;
	};
	const resize = new ResizeObserver(publish);
	resize.observe(node);
	const intersect = new IntersectionObserver(
		([entry]) => {
			visible = entry.intersectionRatio >= ENOUGH_VISIBLE;
			publish();
		},
		{ threshold: [0, ENOUGH_VISIBLE, 1] },
	);
	intersect.observe(node);
	// Scrolling moves the seat without resizing anything, and any ancestor
	// can be the scroller — hence the capturing window listener.
	window.addEventListener('scroll', publish, true);
	window.addEventListener('resize', publish);
	publish();
	return () => {
		resize.disconnect();
		intersect.disconnect();
		window.removeEventListener('scroll', publish, true);
		window.removeEventListener('resize', publish);
		stageSlot.seat = null;
	};
}
