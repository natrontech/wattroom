/**
 * A pane remembers the size you dragged it to (#280).
 *
 * The browser's own `resize` handle does the dragging; this only restores the
 * last size on mount and records the new one. Per device, like every other
 * layout preference — a pane is furniture, not account state.
 */
export function keepSize(key: string, axis: 'both' | 'horizontal' = 'both') {
	return (node: HTMLElement) => {
		try {
			const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
			if (saved?.w > 0) node.style.width = `${saved.w}px`;
			if (axis === 'both' && saved?.h > 0) node.style.height = `${saved.h}px`;
		} catch {
			// blocked storage: the pane opens at its default size
		}
		const observer = new ResizeObserver(() => {
			const w = node.offsetWidth;
			const h = node.offsetHeight;
			if (w < 1 || h < 1) return; // a hidden pane measures zero
			try {
				localStorage.setItem(key, JSON.stringify({ w, h }));
			} catch {
				// see above
			}
		});
		observer.observe(node);
		return () => observer.disconnect();
	};
}
