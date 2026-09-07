/**
 * The event came from somewhere the browser's own key handling should win —
 * a field being typed in. Every window-level shortcut checks this first, so a
 * rider writing a workout name does not fire the soundboard or an undo.
 */
export function isTyping(event: Event): boolean {
	const el = event.target as HTMLElement | null;
	return (
		!!el?.isContentEditable ||
		['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')
	);
}
