/**
 * The app's own tooltip (#4427): an icon button says its name the moment a
 * pointer reaches it or a keyboard focuses it. The native `title` waited a
 * second for a pointer held still, never came for one still moving or for a
 * keyboard, and came when it liked in the desktop shell — so a ride's TV,
 * +1 min and Skip said nothing at all.
 *
 * One tooltip at a time, drawn by `TooltipHost` in the root layout the way
 * `ContextMenuHost` draws the one menu; `{@attach tooltip('TV mode')}` hangs
 * it on a node. A finger never sees it: a tap acts, and nothing a rider
 * needs lives only here beyond the name (ux.md).
 */

export type Rect = { left: number; top: number; right: number; bottom: number };

export const tip = $state<{
	/** The button's name: the line a rider reads. */
	name: string;
	/** A second, quieter line: why it is off, what one tap sends. */
	more: string;
	anchor: HTMLElement | null;
}>({ name: '', more: '', anchor: null });

export function hideTip(): void {
	tip.anchor = null;
	tip.name = '';
	tip.more = '';
}

/** The gap between the button and its tooltip, and the viewport's margin. */
const GAP = 8;
const MARGIN = 8;

/**
 * Where a `w` × `h` tooltip stands for a button at `anchor` in a `vw` × `vh`
 * viewport: above it, centred, else below, else beside it, right then left;
 * always inside the viewport and never over the button while any side has
 * room. With none (a window smaller than the tooltip), the roomier of above
 * and below, pressed to the viewport's edge.
 */
export function placeTip(
	anchor: Rect,
	w: number,
	h: number,
	vw: number,
	vh: number,
): { left: number; top: number; side: 'above' | 'below' | 'right' | 'left' } {
	const clampLeft = (l: number) =>
		Math.max(MARGIN, Math.min(l, vw - w - MARGIN));
	const clampTop = (t: number) =>
		Math.max(MARGIN, Math.min(t, vh - h - MARGIN));
	const centreLeft = clampLeft((anchor.left + anchor.right) / 2 - w / 2);
	const middleTop = clampTop((anchor.top + anchor.bottom) / 2 - h / 2);
	const above = anchor.top - GAP - h;
	const below = anchor.bottom + GAP;
	const right = anchor.right + GAP;
	const left = anchor.left - GAP - w;
	if (above >= MARGIN) return { left: centreLeft, top: above, side: 'above' };
	if (below + h <= vh - MARGIN)
		return { left: centreLeft, top: below, side: 'below' };
	if (right + w <= vw - MARGIN)
		return { left: right, top: middleTop, side: 'right' };
	if (left >= MARGIN) return { left, top: middleTop, side: 'left' };
	return anchor.top >= vh - anchor.bottom
		? { left: centreLeft, top: MARGIN, side: 'above' }
		: {
				left: centreLeft,
				top: Math.max(MARGIN, vh - h - MARGIN),
				side: 'below',
			};
}

/**
 * Attachment: `{@attach tooltip(name, more?)}`. Shows on a mouse or pen
 * entering and on a keyboard's focus (`:focus-visible`, so a click's focus
 * does not); hides on leave, blur, Escape and a press, and a pressed button
 * stays quiet until the pointer leaves it. A falsy name and more attach
 * nothing. `more` is also the button's accessible description, the part of
 * `title` that `aria-label` does not already carry.
 */
export function tooltip(
	name: string | null | undefined,
	more?: string | null,
): (node: HTMLElement) => (() => void) | void {
	return (node) => {
		const named = name ?? '';
		const said = more ?? '';
		if (!named && !said) {
			if (tip.anchor === node) hideTip();
			return;
		}
		// A label that changed under a tooltip already showing (Skip on the
		// last block) changes in place: the attachment re-runs, the pointer
		// has not moved.
		if (tip.anchor === node) {
			tip.name = named;
			tip.more = said;
		}
		if (said) node.setAttribute('aria-description', said);

		let pressed = false;
		const show = () => {
			tip.name = named;
			tip.more = said;
			tip.anchor = node;
		};
		const hide = () => {
			if (tip.anchor === node) hideTip();
		};
		const onEnter = (event: PointerEvent) => {
			if (event.pointerType === 'touch' || pressed) return;
			show();
		};
		const onLeave = () => {
			pressed = false;
			hide();
		};
		const onPress = () => {
			pressed = true;
			hide();
		};
		const onFocus = () => {
			if (keyboardFocus(node)) show();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') hide();
		};
		node.addEventListener('pointerenter', onEnter);
		node.addEventListener('pointerleave', onLeave);
		node.addEventListener('pointercancel', onLeave);
		node.addEventListener('pointerdown', onPress);
		node.addEventListener('click', hide);
		node.addEventListener('focus', onFocus);
		node.addEventListener('blur', hide);
		document.addEventListener('keydown', onKey);
		return () => {
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', onLeave);
			node.removeEventListener('pointercancel', onLeave);
			node.removeEventListener('pointerdown', onPress);
			node.removeEventListener('click', hide);
			node.removeEventListener('focus', onFocus);
			node.removeEventListener('blur', hide);
			document.removeEventListener('keydown', onKey);
			if (said) node.removeAttribute('aria-description');
			// A re-run is the same node coming straight back with its new label;
			// only a button that went away takes its tooltip with it. The block
			// that removes it does so in the same flush, so look a beat later.
			queueMicrotask(() => {
				if (tip.anchor === node && !node.isConnected) hideTip();
			});
		};
	};
}

/** A focus a keyboard made: the browser's own `:focus-visible` heuristic. */
function keyboardFocus(node: HTMLElement): boolean {
	try {
		return node.matches(':focus-visible');
	} catch {
		return false;
	}
}
