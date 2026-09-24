/**
 * A rider's hover card (#2739): rest the pointer on a rider's face or name
 * and their card opens beside it — name, level, status, where they are, and
 * the two ways on. One card at a time, drawn by `RiderCardHost` in the root
 * layout, the way `ContextMenuHost` draws the one menu.
 *
 * Desktop pointers only. A tap on a phone still opens the rider's page, and
 * everything the card says is on that page, so nothing lives only in the
 * hover (ux.md).
 */

/** How long the pointer rests before a card opens — Slack's beat. */
export const OPEN_MS = 400;
/** The grace to cross from the face to the card before it closes. */
export const CLOSE_MS = 150;
/** The card's width in px, which placement reserves. */
export const CARD_W = 288;

let current = $state<{ id: string; anchor: HTMLElement } | null>(null);
let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleClose() {
	clearTimeout(closeTimer);
	closeTimer = setTimeout(() => (current = null), CLOSE_MS);
}

export const riderCard = {
	get current() {
		return current;
	},
	/** The pointer reached the card: it stays. */
	keep() {
		clearTimeout(closeTimer);
	},
	/** The pointer left the card. */
	leave: scheduleClose,
	close() {
		clearTimeout(openTimer);
		clearTimeout(closeTimer);
		current = null;
	},
};

const hovers = () =>
	typeof matchMedia === 'function' &&
	matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Attach to a rider's face or name. Moving from one rider to the next while
 * a card is open swaps it at once — the wait is for the first card only.
 */
export function hoverCard(id: () => string | null | undefined) {
	return (node: HTMLElement) => {
		const enter = (event: PointerEvent) => {
			if (event.pointerType !== 'mouse' || !hovers()) return;
			const who = id();
			if (!who) return;
			clearTimeout(closeTimer);
			if (current?.anchor === node) return;
			clearTimeout(openTimer);
			openTimer = setTimeout(
				() => (current = { id: who, anchor: node }),
				current ? 0 : OPEN_MS,
			);
		};
		const leave = () => {
			clearTimeout(openTimer);
			if (current) scheduleClose();
		};
		// A click goes where the face goes; the card has done its job.
		const down = () => riderCard.close();
		node.addEventListener('pointerenter', enter);
		node.addEventListener('pointerleave', leave);
		node.addEventListener('pointerdown', down);
		return () => {
			node.removeEventListener('pointerenter', enter);
			node.removeEventListener('pointerleave', leave);
			node.removeEventListener('pointerdown', down);
			clearTimeout(openTimer);
			if (current?.anchor === node) current = null;
		};
	};
}

/**
 * Where the card goes: beside the face — right, else left — its top level
 * with the face's and kept on screen; below it when neither side has room.
 */
export function placeCard(
	anchor: { left: number; right: number; top: number; bottom: number },
	height: number,
	viewport: { width: number; height: number },
	gap = 8,
): { left: number; top: number } {
	const clampTop = (top: number) =>
		Math.max(gap, Math.min(top, viewport.height - height - gap));
	if (anchor.right + gap + CARD_W <= viewport.width - gap)
		return { left: anchor.right + gap, top: clampTop(anchor.top) };
	if (anchor.left - gap - CARD_W >= gap)
		return { left: anchor.left - gap - CARD_W, top: clampTop(anchor.top) };
	return {
		left: Math.max(gap, Math.min(anchor.left, viewport.width - CARD_W - gap)),
		top: clampTop(anchor.bottom + gap),
	};
}
