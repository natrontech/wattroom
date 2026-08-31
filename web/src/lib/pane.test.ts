// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { centrePane, dragPane, keepSize, restorePane } from '$lib/pane';

// Ported from the duplicate stage PR (#294), adapted to this pane module:
// sizes are read from the inline style the browser's resize handle writes,
// not from the measured box, and position joins size in one record.

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
	clear: () => store.clear(),
});

/** Stand-in for the browser's observer, so the callback can be driven. */
let fire: () => void = () => {};
class FakeResizeObserver {
	constructor(private cb: () => void) {
		fire = () => this.cb();
	}
	observe() {}
	disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);
Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

const KEY = 'wattroom.pane.test';

function pane(width: number, height: number) {
	const node = document.createElement('div');
	Object.defineProperty(node, 'offsetWidth', { get: () => width });
	Object.defineProperty(node, 'offsetHeight', { get: () => height });
	return node;
}

/** A floating pane with the grab bar inside it, as the components build it. */
function floating(width: number, height: number) {
	const node = pane(width, height);
	node.dataset.pane = 'test';
	const handle = document.createElement('div');
	node.appendChild(handle);
	return { node, handle };
}

describe('keepSize (#280)', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.style.cssText = '';
	});

	it('restores the size it was left at', () => {
		localStorage.setItem(KEY, JSON.stringify({ w: 640, h: 300 }));
		const node = pane(640, 300);
		keepSize(node, 'test');
		expect(node.style.width).toBe('640px');
		expect(node.style.height).toBe('300px');
	});

	it('restores only the width of a horizontal pane', () => {
		// The side panel is full height by layout, and `resize: horizontal`
		// never writes an inline height — so none is ever stored to fight it.
		localStorage.setItem(KEY, JSON.stringify({ w: 420, h: 0 }));
		const node = pane(420, 900);
		keepSize(node, 'test');
		expect(node.style.width).toBe('420px');
		expect(node.style.height).toBe('');
	});

	it('records a drag', () => {
		const node = pane(700, 320);
		node.style.height = '420px'; // the component's authored default
		keepSize(node, 'test');
		node.style.width = '700px';
		node.style.height = '320px';
		fire();
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ w: 700, h: 320 });
	});

	it('keeps a dragged position when the size changes', () => {
		// save() merges; a resize that dropped x/y would send a floating pane
		// back to its corner the next time it was opened.
		localStorage.setItem(KEY, JSON.stringify({ x: 120, y: 64 }));
		const node = pane(500, 300);
		keepSize(node, 'test');
		node.style.width = '500px';
		fire();
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
			x: 120,
			y: 64,
			w: 500,
			h: 0,
		});
	});

	it('ignores a resize that did not come from a drag', () => {
		// A column reflow resizes the pane without touching its inline size:
		// storing then would freeze today's default and outlive tomorrow's.
		const node = pane(976, 420);
		node.style.height = '420px';
		keepSize(node, 'test');
		fire();
		expect(localStorage.getItem(KEY)).toBe(null);
	});

	it('publishes its width for fixed neighbours, and takes it back', () => {
		const node = pane(420, 900);
		const stop = keepSize(node, 'test');
		expect(
			document.documentElement.style.getPropertyValue('--pane-test-w'),
		).toBe('420px');
		stop();
		expect(
			document.documentElement.style.getPropertyValue('--pane-test-w'),
		).toBe('');
	});

	it('ignores a hidden pane, which measures zero', () => {
		keepSize(pane(0, 0), 'test');
		expect(
			document.documentElement.style.getPropertyValue('--pane-test-w'),
		).toBe('');
	});

	it('opens at the default size when storage is junk', () => {
		localStorage.setItem(KEY, '{not json');
		const node = pane(976, 420);
		expect(() => keepSize(node, 'test')).not.toThrow();
		expect(node.style.width).toBe('');
	});
});

describe('dragPane (#280)', () => {
	beforeEach(() => localStorage.clear());

	it('restores where the pane was left, and stops docking it to a corner', () => {
		localStorage.setItem(KEY, JSON.stringify({ x: 300, y: 200 }));
		const { node, handle } = floating(380, 260);
		dragPane(handle);
		expect([node.style.left, node.style.top]).toEqual(['300px', '200px']);
		// The CSS class docks it bottom-right; a placed pane must beat that.
		expect([node.style.right, node.style.bottom]).toEqual(['auto', 'auto']);
	});

	it('keeps a pane stored off a bigger screen grabbable', () => {
		localStorage.setItem(KEY, JSON.stringify({ x: 2400, y: 1600 }));
		const { node, handle } = floating(380, 260);
		dragPane(handle);
		// 80px of pane stays on screen horizontally, 40px vertically.
		expect([node.style.left, node.style.top]).toEqual(['920px', '760px']);
	});

	it('keeps a pane dragged off the left edge grabbable too', () => {
		localStorage.setItem(KEY, JSON.stringify({ x: -5000, y: -5000 }));
		const { node, handle } = floating(380, 260);
		dragPane(handle);
		// Far enough left that 80px of its right edge still shows; never above.
		expect([node.style.left, node.style.top]).toEqual(['-300px', '0px']);
	});

	it('leaves an undragged pane to its CSS corner', () => {
		const { node, handle } = floating(380, 260);
		dragPane(handle);
		expect([node.style.left, node.style.top]).toEqual(['', '']);
	});

	it('centres a pane and remembers it', () => {
		const { node, handle } = floating(380, 260);
		dragPane(handle);
		centrePane(node, 'test');
		expect([node.style.left, node.style.top]).toEqual(['310px', '270px']);
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ x: 310, y: 270 });
	});
});

// #316: the stage borrows the dock's rect so the player can seat inline. The
// borrowed size is the stage's, and giving the dock back means giving back
// exactly what the rider had — not whatever the stage happened to be.
describe('a borrowed pane (#316)', () => {
	const FLOATING = { w: 380, h: 308 };
	beforeEach(() => localStorage.clear());

	it('does not store the size something else is driving', () => {
		const node = pane(380, 308);
		keepSize(node, 'test');
		node.dataset.seated = '';
		node.style.width = '900px';
		node.style.height = '506px';
		fire();
		expect(localStorage.getItem(KEY)).toBe(null);
	});

	it('gives an undragged dock back its authored size and corner', () => {
		const node = pane(380, 308);
		node.style.left = '100px';
		node.style.width = '900px';
		restorePane(node, 'test', FLOATING);
		expect([node.style.width, node.style.height]).toEqual(['380px', '308px']);
		expect([node.style.left, node.style.right]).toEqual(['', '']);
	});

	it('gives a dragged and resized dock back what the rider chose', () => {
		localStorage.setItem(KEY, JSON.stringify({ w: 520, h: 400, x: 40, y: 60 }));
		const node = pane(520, 400);
		restorePane(node, 'test', FLOATING);
		expect([node.style.width, node.style.height]).toEqual(['520px', '400px']);
		expect([node.style.left, node.style.top]).toEqual(['40px', '60px']);
	});
});
