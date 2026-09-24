/**
 * The chat's writing boxes — the composer and a line being edited (#2642).
 * Both were `<input>`s, which cannot hold a line break and hide the start of
 * a long line off their left edge. A textarea fixes both, given two things
 * the input did for free: it grows with its text, and Enter sends.
 */

/**
 * Grows the box to its text, up to its own CSS max-height. `value` is read
 * so a draft cleared or restored by code — sent, refused, a completed
 * mention — refits too; no `input` event fires for those.
 */
export const fitsText =
	(value: () => string) =>
	(node: HTMLTextAreaElement): void => {
		value();
		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
	};

/**
 * Whether this keydown sends. Shift+Enter is a new line, and so is an Enter
 * that ends an IME composition. A touch keyboard has no Shift+Enter, so there
 * its Enter is the new line and the Send button sends.
 */
export function sendsOnEnter(
	e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'>,
	touch = matchMedia('(pointer: coarse)').matches,
): boolean {
	return e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch;
}
