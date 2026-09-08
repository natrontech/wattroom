// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { focusTrap } from './focus-trap';

afterEach(() => {
	document.body.innerHTML = '';
});

// Modal's portal moves the dialog to <body> right after this action ran, and
// moving a subtree blurs whatever it holds (#1138). The trap's first focus has
// to land after that move, not before it.
it('focuses the first control even when the dialog is portalled after mount', async () => {
	const backdrop = document.createElement('div');
	const box = document.createElement('div');
	const first = document.createElement('button');
	first.textContent = 'Delete';
	box.append(first, document.createElement('button'));
	backdrop.appendChild(box);
	document.body
		.appendChild(document.createElement('div'))
		.appendChild(backdrop);

	const trap = focusTrap(box);
	document.body.appendChild(backdrop); // what Modal's portal does, one effect later
	await Promise.resolve();
	expect(document.activeElement).toBe(first);
	trap.destroy();
});
