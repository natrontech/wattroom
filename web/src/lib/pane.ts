/**
 * Panes that stay where you put them (#280): dragged size, dragged position,
 * remembered per device — a pane layout is a desk, not account state.
 *
 * `keepSize` restores the width and height a divider last wrote and publishes
 * them as CSS variables, so fixed neighbours can get out of the way.
 * `dragPane` moves the nearest `[data-pane]` ancestor, whose value is the key
 * — the popped-out stage is the one surface the rider still positions by
 * hand. Resizing is a divider now ($lib/divider), never a grip on the pane.
 */
import { type Guides, snapSpan } from '$lib/pane-snap';

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
		const root = document.documentElement.style;
		// A hidden pane (the dock with nothing playing) publishes nothing — a
		// stale height would keep every gutter reserved for a player that is
		// not there.
		if (node.offsetWidth > 0)
			root.setProperty(`--pane-${key}-w`, `${node.offsetWidth}px`);
		else root.removeProperty(`--pane-${key}-w`);
		// Height too: the jukebox dock floats over the content column, and the
		// training place reserves that much so the player never sits on the
		// crew strip or the horizon (ADR-0020).
		if (node.offsetHeight > 0)
			root.setProperty(`--pane-${key}-h`, `${node.offsetHeight}px`);
		else root.removeProperty(`--pane-${key}-h`);
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
