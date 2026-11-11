// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { hideTip, placeTip, tip, tooltip } from '#lib/tooltip.svelte.ts';

// A 1440 × 900 window; a 44 px button and a 100 × 30 tooltip.
const VW = 1440;
const VH = 900;
const button = (left: number, top: number, size = 44) => ({
	left,
	top,
	right: left + size,
	bottom: top + size,
});
const overlaps = (
	a: { left: number; top: number; right: number; bottom: number },
	b: { left: number; top: number; right: number; bottom: number },
) =>
	a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('placeTip', () => {
	it('stands above the button, centred on it', () => {
		expect(placeTip(button(500, 800), 100, 30, VW, VH)).toEqual({
			left: 472,
			top: 762,
			side: 'above',
		});
	});
	it('goes below a button at the top of the window', () => {
		expect(placeTip(button(500, 10), 100, 30, VW, VH)).toEqual({
			left: 472,
			top: 62,
			side: 'below',
		});
	});
	it('stays inside the window at either edge', () => {
		expect(placeTip(button(0, 800), 100, 30, VW, VH).left).toBe(8);
		expect(placeTip(button(1420, 800, 20), 100, 30, VW, VH).left).toBe(1332);
	});
	it('stands beside a button in a window too short for above or below', () => {
		const at = button(500, 10);
		const short = placeTip(at, 100, 30, VW, 80);
		expect(short.side).toBe('right');
		expect(short.left).toBe(552);
		expect(short.top + 30).toBeLessThanOrEqual(72);
		const right = button(1380, 10);
		expect(placeTip(right, 100, 30, VW, 80).side).toBe('left');
	});
	it('never covers the button while any side has room', () => {
		for (const [x, y] of [
			[0, 0],
			[1396, 0],
			[0, 856],
			[1396, 856],
			[700, 430],
		]) {
			const at = button(x, y);
			const p = placeTip(at, 100, 30, VW, VH);
			const box = {
				left: p.left,
				top: p.top,
				right: p.left + 100,
				bottom: p.top + 30,
			};
			expect(overlaps(box, at)).toBe(false);
			expect(box.left).toBeGreaterThanOrEqual(8);
			expect(box.right).toBeLessThanOrEqual(VW - 8);
			expect(box.top).toBeGreaterThanOrEqual(8);
			expect(box.bottom).toBeLessThanOrEqual(VH - 8);
		}
	});
	it('with no room anywhere, keeps to the window on the roomier side', () => {
		const p = placeTip(button(10, 20, 200), 300, 50, 320, 260);
		expect(p.side).toBe('below');
		expect(p.top).toBe(202);
	});
});

describe('tooltip', () => {
	afterEach(() => {
		hideTip();
		document.body.innerHTML = '';
	});

	const mount = (name: string | null, more?: string) => {
		const node = document.createElement('button');
		document.body.append(node);
		const detach = tooltip(name, more)(node);
		return { node, detach };
	};
	const pointer = (node: HTMLElement, type: string, pointerType = 'mouse') =>
		node.dispatchEvent(new PointerEvent(type, { pointerType }));

	it('shows the name at once for a mouse and goes on leave', () => {
		const { node } = mount('TV mode');
		pointer(node, 'pointerenter');
		expect(tip.anchor).toBe(node);
		expect(tip.name).toBe('TV mode');
		pointer(node, 'pointerleave');
		expect(tip.anchor).toBeNull();
	});
	it('never shows for a finger: a tap acts', () => {
		const { node } = mount('TV mode');
		pointer(node, 'pointerenter', 'touch');
		expect(tip.anchor).toBeNull();
	});
	it('goes on a press and stays away until the pointer leaves', () => {
		const { node } = mount('Skip block');
		pointer(node, 'pointerenter');
		pointer(node, 'pointerdown');
		expect(tip.anchor).toBeNull();
		pointer(node, 'pointerenter');
		expect(tip.anchor).toBeNull();
		pointer(node, 'pointerleave');
		pointer(node, 'pointerenter');
		expect(tip.anchor).toBe(node);
	});
	it('goes on Escape and on blur', () => {
		const { node } = mount('TV mode');
		pointer(node, 'pointerenter');
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(tip.anchor).toBeNull();
		pointer(node, 'pointerleave');
		pointer(node, 'pointerenter');
		node.dispatchEvent(new FocusEvent('blur'));
		expect(tip.anchor).toBeNull();
	});
	it('carries the second line as the description, and takes it back', () => {
		const { node, detach } = mount('Flag a problem', 'Something wrong?');
		expect(node.getAttribute('aria-description')).toBe('Something wrong?');
		pointer(node, 'pointerenter');
		expect(tip.more).toBe('Something wrong?');
		detach?.();
		expect(node.hasAttribute('aria-description')).toBe(false);
	});
	it('a label that changes under it changes in place', async () => {
		const { node, detach } = mount('Skip block');
		pointer(node, 'pointerenter');
		detach?.();
		tooltip('Skip block', 'Last block — End ride instead')(node);
		await Promise.resolve();
		expect(tip.anchor).toBe(node);
		expect(tip.more).toBe('Last block — End ride instead');
	});
	it('goes with a button that goes away', async () => {
		const { node, detach } = mount('One more minute');
		pointer(node, 'pointerenter');
		node.remove();
		detach?.();
		await Promise.resolve();
		expect(tip.anchor).toBeNull();
	});
	it('attaches nothing with nothing to say', () => {
		const { node } = mount(null);
		pointer(node, 'pointerenter');
		expect(tip.anchor).toBeNull();
	});
});
