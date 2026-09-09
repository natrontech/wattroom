/**
 * Whose Space bar it is while push-to-talk is on (audit 2026-09-09).
 *
 * The room's PTT listener sits on the window and used to yield Space only
 * to text fields. A native button activates on Space at keyup, and
 * preventDefault on the keydown suppressed that: a keyboard rider who tabbed
 * to Mute or End the session and pressed Space got a hot mic and no click.
 * Enter still worked, so it was silent rather than obvious.
 *
 * The mouse rider is the other half: they click Join voice, focus stays on
 * the button, and they hold Space to talk. So a control claims Space only
 * when it was reached by keyboard — `:focus-visible` is the browser's own
 * word for that — and a mouse-focused button leaves it to the mic.
 */
export function spaceBelongsTo(
	target: EventTarget | null,
	focusVisible: (el: Element) => boolean = (el) => el.matches(':focus-visible'),
): boolean {
	if (!(target instanceof Element)) return false;
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		(target as HTMLElement).isContentEditable
	)
		return true;
	const control = target.closest(
		'button, a[href], select, summary, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"]',
	);
	return !!control && focusVisible(control);
}
