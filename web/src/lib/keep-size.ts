/**
 * Remember a hand-dragged pane size across reloads (#280).
 *
 * The panes resize natively — CSS `resize` writes the dragged width/height as
 * inline styles, so there is nothing to reimplement. All this does is restore
 * those two numbers on mount and write them back when they change, which is
 * why the whole Discord-ish "panes stay where I put them" behaviour costs one
 * ResizeObserver and no drag code.
 *
 * Per-device, like the mixer: a pane layout is a desk, not account state.
 */
export function keepSize(node: HTMLElement, key: string): () => void {
	const storageKey = `wattroom.pane.${key}`;
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
		if (saved?.w > 0) node.style.width = `${saved.w}px`;
		if (saved?.h > 0) node.style.height = `${saved.h}px`;
	} catch {
		// storage blocked: the CSS default size stands
	}
	// Nothing is stored until the size differs from what the component (or the
	// restore above) authored — otherwise today's default freezes into storage
	// and tomorrow's never reaches anyone who once opened a room.
	const authored = `${node.style.width}|${node.style.height}`;
	const observer = new ResizeObserver(() => {
		// Published so fixed-position neighbours can get out of the way — the
		// jukebox dock has to sit left of however wide the panel now is.
		if (node.offsetWidth > 0)
			document.documentElement.style.setProperty(
				`--pane-${key}-w`,
				`${node.offsetWidth}px`,
			);
		if (`${node.style.width}|${node.style.height}` === authored) return;
		// Only what the drag wrote — an untouched axis stays '' and keeps
		// following the layout instead of freezing at today's viewport.
		const w = parseInt(node.style.width, 10) || 0;
		const h = parseInt(node.style.height, 10) || 0;
		try {
			localStorage.setItem(storageKey, JSON.stringify({ w, h }));
		} catch {
			// desk-only preference; losing it costs one drag
		}
	});
	observer.observe(node);
	return () => {
		observer.disconnect();
		document.documentElement.style.removeProperty(`--pane-${key}-w`);
	};
}
