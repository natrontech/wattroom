// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { clampSize, dividerDrag, edgeDivider } from '$lib/divider';

function grip() {
	const node = document.createElement('div');
	node.setPointerCapture = vi.fn();
	return node;
}

function drag(node: HTMLElement, kind: string, x: number, y: number) {
	node.dispatchEvent(
		new MouseEvent(kind, { clientX: x, clientY: y, bubbles: false }),
	);
}

describe('dividerDrag (#427)', () => {
	it('grows the pane the way the pointer went', () => {
		const node = grip();
		const sizes: number[] = [];
		dividerDrag(node, { axis: 'y', from: () => 400, to: (h) => sizes.push(h) });
		drag(node, 'pointerdown', 0, 100);
		drag(node, 'pointermove', 0, 160);
		expect(sizes).toEqual([460]);
	});

	it('grows the other way for a pane that lies after its divider', () => {
		const node = grip();
		const sizes: number[] = [];
		dividerDrag(node, {
			axis: 'x',
			sign: -1,
			from: () => 320,
			to: (w) => sizes.push(w),
		});
		// The side panel: pulling the seam left makes the column wider.
		drag(node, 'pointerdown', 900, 0);
		drag(node, 'pointermove', 860, 0);
		expect(sizes).toEqual([360]);
	});

	it('ignores a move that no press started, and persists once on release', () => {
		const node = grip();
		const to = vi.fn();
		const done = vi.fn();
		dividerDrag(node, { axis: 'y', from: () => 400, to, done });
		drag(node, 'pointermove', 0, 500);
		expect(to).not.toHaveBeenCalled();
		drag(node, 'pointerup', 0, 500);
		expect(done).not.toHaveBeenCalled();

		drag(node, 'pointerdown', 0, 100);
		drag(node, 'pointermove', 0, 120);
		drag(node, 'pointerup', 0, 120);
		expect(done).toHaveBeenCalledTimes(1);
		// A stray move after the release is not a resize.
		drag(node, 'pointermove', 0, 900);
		expect(to).toHaveBeenCalledTimes(1);
	});

	it('stops listening once torn down', () => {
		const node = grip();
		const to = vi.fn();
		dividerDrag(node, { axis: 'y', from: () => 400, to })();
		drag(node, 'pointerdown', 0, 100);
		drag(node, 'pointermove', 0, 200);
		expect(to).not.toHaveBeenCalled();
	});
});

describe('clampSize', () => {
	it('keeps a size between its floor and ceiling, in whole pixels', () => {
		expect(clampSize(420.4, 200, 800)).toBe(420);
		expect(clampSize(10, 200, 800)).toBe(200);
		expect(clampSize(9000, 200, 800)).toBe(800);
	});
});

describe('edgeDivider', () => {
	it("resizes the grip's parent within the parent's own CSS bounds", () => {
		const pane = document.createElement('div');
		pane.style.minWidth = '180px';
		pane.style.maxWidth = '400px';
		const node = grip();
		pane.appendChild(node);
		document.body.appendChild(pane); // computed style resolves only in the tree
		edgeDivider(node);
		// The sidebar: the column lies left of its grip, so pulling right
		// widens it — and never past the ceiling the pane declares.
		drag(node, 'pointerdown', 240, 0);
		drag(node, 'pointermove', 900, 0);
		expect(pane.style.width).toBe('400px');
		drag(node, 'pointermove', 0, 0);
		expect(pane.style.width).toBe('180px');
	});
});
