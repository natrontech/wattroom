/**
 * The one way a surface is resized in this app (#427): a divider between two
 * panes, dragged.
 *
 * There used to be three — CSS `resize`'s corner of diagonal lines on the
 * stage, invisible edge grips on the floating dock, and this strip on the
 * side panel. Two of them were a pixel you had to find, and neither said what
 * it would resize. A divider says it: it sits ON the seam, it is the width of
 * a border, and it lights up under the pointer.
 */
export interface Divider {
	/** 'x' resizes across the divider, 'y' resizes above/below it. */
	axis: 'x' | 'y';
	/** The pane's size in px as the drag starts. */
	from: () => number;
	/** The size the pointer is asking for — clamp and apply it. */
	to: (size: number) => void;
	/**
	 * Which way the pane grows. 1 when the pane lies BEFORE the divider (drag
	 * away from the origin to grow), -1 when it lies after it — the side
	 * panel sits right of its grip, so pulling left makes it wider.
	 */
	sign?: 1 | -1;
	/** The drag is over: persist whatever `to` last applied. */
	done?: () => void;
}

/** Attach to the divider element itself; returns the teardown. */
export function dividerDrag(grip: HTMLElement, divider: Divider): () => void {
	const sign = divider.sign ?? 1;
	let from: { at: number; size: number } | null = null;

	const down = (event: PointerEvent) => {
		from = {
			at: divider.axis === 'x' ? event.clientX : event.clientY,
			size: divider.from(),
		};
		grip.setPointerCapture(event.pointerId);
		// Pointer capture alone does not stop the browser selecting text under
		// a drag that started on a strip this thin.
		event.preventDefault();
	};
	const move = (event: PointerEvent) => {
		if (!from) return;
		const at = divider.axis === 'x' ? event.clientX : event.clientY;
		divider.to(from.size + sign * (at - from.at));
	};
	const up = () => {
		if (!from) return;
		from = null;
		divider.done?.();
	};

	grip.addEventListener('pointerdown', down);
	grip.addEventListener('pointermove', move);
	grip.addEventListener('pointerup', up);
	grip.addEventListener('pointercancel', up);
	return () => {
		grip.removeEventListener('pointerdown', down);
		grip.removeEventListener('pointermove', move);
		grip.removeEventListener('pointerup', up);
		grip.removeEventListener('pointercancel', up);
	};
}

/** Keep a size between its floor and ceiling — every divider needs this sum. */
export function clampSize(size: number, min: number, max: number): number {
	return Math.round(Math.max(min, Math.min(max, size)));
}

/**
 * A divider on a column's own edge: the grip's parent is the pane, and its
 * CSS min/max width are the bounds. `sign` is -1 for a column right of its
 * grip (the room's panel), 1 for one left of it (the sidebar).
 */
export function edgeDivider(
	grip: HTMLElement,
	sign: 1 | -1 = 1,
): (() => void) | undefined {
	const pane = grip.parentElement;
	if (!pane) return;
	return dividerDrag(grip, {
		axis: 'x',
		sign,
		from: () => pane.offsetWidth,
		to: (width) => {
			const style = getComputedStyle(pane);
			pane.style.width = `${clampSize(
				width,
				parseFloat(style.minWidth) || 0,
				parseFloat(style.maxWidth) || window.innerWidth,
			)}px`;
		},
	});
}
