/**
 * Panes that stay where you put them (#280): dragged size, dragged position,
 * remembered per device — a pane layout is a desk, not account state.
 *
 * Size needs no drag code at all: CSS `resize` writes the dragged width and
 * height as inline styles, so `keepSize` only restores those two numbers and
 * writes them back. Position does need code, but only for floating panes —
 * `dragPane` moves the nearest `[data-pane]` ancestor, whose value is the key.
 */
import {
	CURSOR,
	EDGES,
	type Edge,
	gripStyle,
	type Guides,
	resizeRect,
	snapSpan,
} from '$lib/pane-snap';

interface Spot {
	w?: number;
	h?: number;
	x?: number;
	y?: number;
}

function storageKey(key: string) {
	return `wattroom.pane.${key}`;
}

function load(key: string): Spot {
	try {
		return JSON.parse(localStorage.getItem(storageKey(key)) ?? '{}') as Spot;
	} catch {
		return {};
	}
}

function save(key: string, patch: Spot) {
	try {
		localStorage.setItem(
			storageKey(key),
			JSON.stringify({ ...load(key), ...patch }),
		);
	} catch {
		// desk-only preference; losing it costs one drag
	}
}

export function keepSize(node: HTMLElement, key: string): () => void {
	const saved = load(key);
	if (saved.w) node.style.width = `${saved.w}px`;
	if (saved.h) node.style.height = `${saved.h}px`;
	// Nothing is stored until the size differs from what the component (or the
	// restore above) authored — otherwise today's default freezes into storage
	// and tomorrow's never reaches anyone who once opened a room.
	const authored = `${node.style.width}|${node.style.height}`;
	// Published so fixed-position neighbours can get out of the way — the
	// jukebox dock has to sit left of however wide the panel now is. Set here
	// too, not only from the observer: a neighbour laid out in the same frame
	// must not fall back to the default width for a tick.
	const publish = () => {
		if (node.offsetWidth > 0)
			document.documentElement.style.setProperty(
				`--pane-${key}-w`,
				`${node.offsetWidth}px`,
			);
		// Height too: the jukebox dock floats over the content column, and the
		// training place reserves that much so the player never sits on the
		// crew strip or the horizon (ADR-0020).
		if (node.offsetHeight > 0)
			document.documentElement.style.setProperty(
				`--pane-${key}-h`,
				`${node.offsetHeight}px`,
			);
	};
	publish();
	const observer = new ResizeObserver(() => {
		publish();
		// Someone else is driving the rect (the stage seat, #316) — that size
		// is the stage's, not one the rider chose.
		if (node.dataset.seated !== undefined) return;
		if (`${node.style.width}|${node.style.height}` === authored) return;
		save(key, {
			w: parseInt(node.style.width, 10) || 0,
			h: parseInt(node.style.height, 10) || 0,
		});
	});
	observer.observe(node);
	return () => {
		observer.disconnect();
		document.documentElement.style.removeProperty(`--pane-${key}-w`);
		document.documentElement.style.removeProperty(`--pane-${key}-h`);
	};
}

/**
 * Put a pane back the way the rider left it, after something else borrowed
 * its rect (#316). `fallback` is the size the component authors, which the
 * borrower overwrote — inline styles have no memory of what they replaced.
 */
export function restorePane(
	node: HTMLElement,
	key: string,
	fallback: { w: number; h: number },
): void {
	const { w, h, x, y } = load(key);
	node.style.width = `${w || fallback.w}px`;
	node.style.height = `${h || fallback.h}px`;
	if (x !== undefined && y !== undefined) place(node, x, y);
	else {
		// Never dragged: back to the corner its CSS docks it to.
		node.style.left = node.style.top = '';
		node.style.right = node.style.bottom = '';
	}
}

/** Enough pane left on screen to grab it again after a viewport change. */
const KEEP_VISIBLE = 80;

function place(pane: HTMLElement, x: number, y: number) {
	pane.style.left = `${Math.min(
		window.innerWidth - KEEP_VISIBLE,
		Math.max(KEEP_VISIBLE - pane.offsetWidth, x),
	)}px`;
	pane.style.top = `${Math.min(
		window.innerHeight - KEEP_VISIBLE / 2,
		Math.max(0, y),
	)}px`;
	// The pane's CSS docks it to a corner; a dragged one is placed instead.
	pane.style.right = 'auto';
	pane.style.bottom = 'auto';
}

/** Put a floating pane in the middle of the viewport, and remember it. */
export function centrePane(node: HTMLElement, key: string): void {
	place(
		node,
		(window.innerWidth - node.offsetWidth) / 2,
		(window.innerHeight - node.offsetHeight) / 2,
	);
	save(key, {
		x: parseInt(node.style.left, 10) || 0,
		y: parseInt(node.style.top, 10) || 0,
	});
}

/**
 * Attach to a grab bar: drags the floating `[data-pane]` it sits in, restores
 * where that pane was left, and keeps it reachable when the window shrinks.
 */
export function dragPane(handle: HTMLElement): () => void {
	const pane = handle.closest<HTMLElement>('[data-pane]');
	const key = pane?.dataset.pane;
	if (!pane || !key) return () => {};

	const reposition = () => {
		const { x, y } = load(key);
		if (x !== undefined && y !== undefined) place(pane, x, y);
	};
	reposition();

	let from: { x: number; y: number; left: number; top: number } | null = null;
	const down = (event: PointerEvent) => {
		// The bar carries buttons (dock, close); a tap on one is not a drag.
		if ((event.target as HTMLElement).closest('button,input,a,select')) return;
		const rect = pane.getBoundingClientRect();
		from = {
			x: event.clientX,
			y: event.clientY,
			left: rect.left,
			top: rect.top,
		};
		handle.setPointerCapture(event.pointerId);
		event.preventDefault(); // no text selection while dragging
	};
	const move = (event: PointerEvent) => {
		if (!from) return;
		const lines = guides();
		place(
			pane,
			snapSpan(from.left + event.clientX - from.x, pane.offsetWidth, lines.x),
			snapSpan(from.top + event.clientY - from.y, pane.offsetHeight, lines.y),
		);
	};
	const up = () => {
		if (!from) return;
		from = null;
		save(key, {
			x: parseInt(pane.style.left, 10) || 0,
			y: parseInt(pane.style.top, 10) || 0,
		});
	};

	handle.addEventListener('pointerdown', down);
	handle.addEventListener('pointermove', move);
	handle.addEventListener('pointerup', up);
	handle.addEventListener('pointercancel', up);
	window.addEventListener('resize', reposition);
	return () => {
		handle.removeEventListener('pointerdown', down);
		handle.removeEventListener('pointermove', move);
		handle.removeEventListener('pointerup', up);
		handle.removeEventListener('pointercancel', up);
		window.removeEventListener('resize', reposition);
	};
}

/**
 * The lines a pane clicks to: the viewport's edges and middle, and the gutter
 * left of the room's side panel — where the dock lives by default, and the
 * one edge a rider actually aims for.
 */
function guides(): Guides {
	const panel = parseFloat(
		getComputedStyle(document.documentElement).getPropertyValue(
			'--pane-side-panel-w',
		),
	);
	const gutter = window.innerWidth - (panel > 0 ? panel : 0);
	return {
		x: [0, window.innerWidth / 2, gutter, window.innerWidth],
		y: [0, window.innerHeight / 2, window.innerHeight],
	};
}

/**
 * Resize a floating pane from any edge or corner, with soft guides (#316).
 * Replaces CSS `resize` on panes that need to be tucked somewhere precise;
 * the grips are transparent and sit in the pane's own margin of chrome, so
 * nothing is drawn over the picture.
 */
export function resizePane(node: HTMLElement, key: string): () => void {
	const grips = EDGES.map((edge) => {
		const grip = document.createElement('div');
		grip.dataset.resize = edge;
		grip.style.cssText =
			`position:absolute;z-index:2;touch-action:none;` +
			`cursor:${CURSOR[edge]}-resize;${gripStyle(edge)}`;
		node.appendChild(grip);
		return grip;
	});

	let from: { edge: Edge; x: number; y: number; rect: DOMRect } | null = null;
	const down = (event: PointerEvent) => {
		const edge = (event.target as HTMLElement).dataset?.resize as
			Edge | undefined;
		if (!edge) return;
		from = {
			edge,
			x: event.clientX,
			y: event.clientY,
			rect: node.getBoundingClientRect(),
		};
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault(); // no text selection while dragging
	};
	const move = (event: PointerEvent) => {
		if (!from) return;
		const style = getComputedStyle(node);
		const next = resizeRect(
			from.rect,
			from.edge,
			event.clientX - from.x,
			event.clientY - from.y,
			{
				minW: parseFloat(style.minWidth) || 0,
				minH: parseFloat(style.minHeight) || 0,
				maxW: parseFloat(style.maxWidth) || window.innerWidth,
				maxH: parseFloat(style.maxHeight) || window.innerHeight,
			},
			guides(),
		);
		node.style.width = `${next.width}px`;
		node.style.height = `${next.height}px`;
		place(node, next.left, next.top);
	};
	const up = () => {
		if (!from) return;
		from = null;
		save(key, {
			w: parseInt(node.style.width, 10) || 0,
			h: parseInt(node.style.height, 10) || 0,
			x: parseInt(node.style.left, 10) || 0,
			y: parseInt(node.style.top, 10) || 0,
		});
	};

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);
	return () => {
		node.removeEventListener('pointerdown', down);
		node.removeEventListener('pointermove', move);
		node.removeEventListener('pointerup', up);
		node.removeEventListener('pointercancel', up);
		for (const grip of grips) grip.remove();
	};
}
