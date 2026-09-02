/**
 * Keep Tab inside one dialog, and hand focus back where it came from when the
 * dialog goes (#230, extracted for the image viewer in #510): `use:focusTrap`
 * on the box that carries `role="dialog"`.
 */
export function focusTrap(node: HTMLElement): { destroy(): void } {
	const prev = document.activeElement as HTMLElement | null;
	const focusables = () =>
		Array.from(
			node.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
			),
		);
	(focusables()[0] ?? node).focus();
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const items = focusables();
		if (!items.length) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			last.focus();
			event.preventDefault();
		} else if (!event.shiftKey && document.activeElement === last) {
			first.focus();
			event.preventDefault();
		}
	}
	node.addEventListener('keydown', onKeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			prev?.focus();
		},
	};
}
